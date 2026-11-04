/**
 * Command 516 - UpgradeUnit
 *
 * Port of the C# UpgradeUnitCommand (Packet 516).
 * Layout (INT x4, confirmed by coc-messages CommandComponent id 516):
 *   INT buildingId (laboratory), INT isSpell (0 = troop), INT unitData (4xxxxxx / 26xxxxxx), INT tick
 *
 * ACS has no GameObjectManager / UnitUpgradeComponent, so the state lives in the
 * village JSON that is already saved with the player (no DB schema change):
 *   village.unit_levels            { "<unitIndex>": level }   level is 0-indexed
 *   laboratory.unit_upg            { unit_type: <unitIndex>, end: <unix secs> }
 *
 * C# -> ACS mapping:
 *   GetGameObjectByID(BuildingId)   -> village.buildings[instanceID]
 *   GetUnitUpgradeLevel(UnitData)   -> village.unit_levels[unitIndex] || 0
 *   CanStartUpgrading(UnitData)     -> building is a Laboratory, lab is idle,
 *                                      unit has a next level, lab level is high enough
 *   GetUpgradeCost / Resource       -> characters.csv row[currentLevel]
 *                                      (UpgradeCost / UpgradeResource)
 *   StartUpgrading(UnitData)        -> sets laboratory.unit_upg with an end time
 *
 * Finishing: call LogicUpgradeUnitCommand.resolveUnitUpgrades(village) on home load
 * (see the hook-in notes delivered with this file).
 */
const fs = require('fs')
const path = require('path')
const Utils = require('../../../Utilities/Utils')
const CSVManager = require('../../../Core/CSVManager')
const { nowSeconds } = require('../../../Core/ConstructionUtils')

const UNIT_CLASS_ID = 4 // 4xxxxxx = characters.csv (troops)
const SPELL_CLASS_ID = 26 // 26xxxxx = spells.csv (spells; also researched in the laboratory)
const LAB_NAME = 'Laboratory'

const tables = {} // file name -> Array<{name, levels}> indexed by unit/spell index

/**
 * The client sends an IsSpell flag next to the unit reference (C# LogicUnitUpgrade /
 * LogicTrainUnit: IsSpell, UnitId). A full global id (4xxxxxx troop, 26xxxxxx spell)
 * already says what it is and is kept as is; a bare index (below 1000000) is turned
 * into a global id with the flag.
 */
function normalizeUnitID (rawID, isSpell) {
  if (rawID >= 1000000) return rawID
  return (isSpell ? 26000000 : 4000000) + rawID
}

function parseCsv (text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/**
 * characters.csv grouped per unit. Unlike CSVManager, blank cells are NOT inherited
 * from the previous level: a blank UpgradeCost on the last row means "max level".
 */
function loadTable (fileName) {
  if (tables[fileName]) return tables[fileName]
  const characters = (tables[fileName] = [])

  try {
    const file = path.join(__dirname, '../../../Gamefiles/csv', fileName)
    if (!fs.existsSync(file)) return characters // e.g. no spells.csv shipped: handled by the caller
    const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const header = rows[0]
    const col = (name) => header.indexOf(name)
    const nameCol = col('Name')
    const num = (row, name) => parseInt(row[col(name)], 10) || 0

    for (const row of rows.slice(2)) { // row 1 holds the column types
      if (row.length < 2) continue
      if (row[nameCol]) characters.push({ name: row[nameCol], levels: [] })
      const unit = characters[characters.length - 1]
      if (!unit) continue
      // UpgradeResource is only written on a unit's FIRST row in characters.csv
      // (later levels leave it blank), so it must be inherited from the previous
      // level. (UpgradeCost is deliberately NOT inherited: blank = max level.)
      const prev = unit.levels[unit.levels.length - 1]
      unit.levels.push({
        laboratoryLevel: num(row, 'LaboratoryLevel'), // lab level needed to own this level
        upgradeTimeH: num(row, 'UpgradeTimeH'),
        upgradeResource: row[col('UpgradeResource')] || (prev ? prev.upgradeResource : ''),
        upgradeCost: num(row, 'UpgradeCost'),
        // A level can be upgraded when the row has an upgrade time or cost WRITTEN (even a
        // literal 0: some characters.csv files have every UpgradeCost = 0). The final level
        // leaves both blank.
        canUpgrade: String(row[col('UpgradeTimeH')] || '').trim() !== '' || String(row[col('UpgradeCost')] || '').trim() !== ''
      })
    }
  } catch (e) {
    console.error(`LogicUpgradeUnitCommand: unable to read ${fileName}`, e.message)
  }

  return characters
}

class LogicUpgradeUnitCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.IsSpell = self.readInt() // 0 = troop, otherwise spell
    this.data.UnitID = normalizeUnitID(self.readInt(), this.data.IsSpell) // 4000000 + unit index / 26000000 + spell index
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 516
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => {
      if (client && typeof client.log === 'function') client.log(`[LogicUpgradeUnitCommand] ${msg}`)
    }
    if (!player) return -1

    const { BuildingID, UnitID } = this.data

    // --- unit / spell -----------------------------------------------------------
    const classID = Utils.getClassID(UnitID)
    const isSpell = classID === SPELL_CLASS_ID
    if (classID !== UNIT_CLASS_ID && !isSpell) return log(`${UnitID} is not a unit or spell`), -1
    if (isSpell !== (this.data.IsSpell !== 0)) log(`isSpell=${this.data.IsSpell} does not match ${UnitID}, using the unit id`)
    const unitIndex = Utils.getInstanceID(UnitID)
    const tableFile = isSpell ? 'spells.csv' : 'characters.csv'
    const levelsKey = isSpell ? 'spell_levels' : 'unit_levels'
    const unit = loadTable(tableFile)[unitIndex]

    // --- village / laboratory ---------------------------------------------------
    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const lab = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(BuildingID)] : null
    if (!lab || Utils.getClassID(BuildingID) !== 500) return log(`building ${BuildingID} not found`), -1

    const group = CSVManager.getRowGroup('buildings', lab.data)
    if (!group || !group[0] || group[0].Name !== LAB_NAME) return log(`building ${BuildingID} is not a laboratory`), -1

    // A laboratory that is itself being built/upgraded cannot research
    if (lab.buildTime || lab.upgradeTime) return log('laboratory is under construction'), -1
    // One research at a time
    if (lab.unit_upg && lab.unit_upg.end) return log('laboratory is already upgrading a unit'), -1

    // --- CanStartUpgrading ------------------------------------------------------
    if (!village[levelsKey] || typeof village[levelsKey] !== 'object') village[levelsKey] = {}
    const unitLevel = Number(village[levelsKey][unitIndex]) || 0

    // No csv row for this troop/spell (e.g. the dark troops are missing from the shipped
    // characters.csv, and there is no spells.csv at all): the server has no cost/time data
    // for it, so the research is applied immediately and not charged. Add the rows to
    // characters.csv / spells.csv (same columns) to get real costs and timers.
    if (!unit) {
      village[levelsKey][unitIndex] = unitLevel + 1
      player.village = JSON.stringify(village)
      player.markModified('village')
      await player.save()
      log(`${isSpell ? 'spell' : 'unit'} ${UnitID} -> level ${unitLevel + 2} (no ${tableFile} data: applied instantly, free)`)
      return 0
    }

    const current = unit.levels[unitLevel]
    const next = unit.levels[unitLevel + 1]
    if (!current || !next || !current.canUpgrade) return log(`${unit.name} is already at max level`), -1

    const labLevel = (lab.lvl || 0) + 1 // lvl is 0-indexed, csv LaboratoryLevel is 1-based
    if (labLevel < next.laboratoryLevel) {
      return log(`laboratory level ${labLevel} < required ${next.laboratoryLevel} for ${unit.name}`), -1
    }

    // --- cost -------------------------------------------------------------------
    const cost = current.upgradeCost
    const field = CSVManager.resourceField(current.upgradeResource)
    if (!field) return log(`unknown upgrade resource "${current.upgradeResource}"`), -1
    if ((Number(player[field]) || 0) < cost) {
      return log(`not enough ${current.upgradeResource} (${player[field]} < ${cost})`), -1
    }
    player[field] = player[field] - cost
    player.markModified(field)

    // --- StartUpgrading ---------------------------------------------------------
    const seconds = current.upgradeTimeH * 3600
    if (seconds > 0) {
      lab.unit_upg = { unit_type: unitIndex, spell: isSpell, end: nowSeconds() + seconds }
    } else {
      village[levelsKey][unitIndex] = unitLevel + 1 // zero time: instant
    }

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`${unit.name} (${UnitID}) -> level ${unitLevel + 2}${seconds > 0 ? ` (${seconds}s)` : ''}, charged ${cost} ${current.upgradeResource}`)
    return 0
  }

  /**
   * Completes laboratory upgrades whose timer has elapsed.
   * Returns { village, changed }; persist only when changed (same contract as
   * ConstructionUtils.resolvePendingConstruction).
   */
  static resolveUnitUpgrades (village) {
    let changed = false
    const now = nowSeconds()
    if (!village || !Array.isArray(village.buildings)) return { village, changed }

    for (const b of village.buildings) {
      const up = b && b.unit_upg
      if (up && up.end && up.end <= now) {
        const key = up.spell ? 'spell_levels' : 'unit_levels'
        if (!village[key]) village[key] = {}
        village[key][up.unit_type] = (Number(village[key][up.unit_type]) || 0) + 1
        delete b.unit_upg
        changed = true
      }
    }
    return { village, changed }
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicUpgradeUnitCommand
