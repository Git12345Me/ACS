/**
 * Command 527 - UpgradeHero
 *
 * Port of the C# LogicUpgradeHeroCommand, modelled on LogicUpgradeBuildingCommand (502).
 * Layout: INT gameObjectId (the hero altar building), INT tick
 *   (C# Decode = ReadInt + base.Decode; the old ACS stub called the tick "UpgradeWithMana")
 *
 * C# -> ACS mapping:
 *   GetGameObjectByID(id)            -> village.buildings[instanceID]
 *   building.IsLocked()              -> altar still under construction (-23); the altar existing in
 *                                       the village is what unlocks the hero
 *   GetVillageType() check           -> n/a, ACS has only the home village               (-32)
 *   HeroBaseComponent.CanStartUpgrading
 *                                    -> altar not already upgrading, next level exists
 *   GetUnitUpgradeLevel(heroData)    -> item.lvl (ClientAvatar writes the altar's lvl as hero level)
 *   GetUpgradeCost / GetUpgradeResource(level)
 *                                    -> heroes.csv row[level].UpgradeCost / UpgradeResource
 *   HasEnoughResources + CommodityCountChangeHelper
 *                                    -> player[field] check and charge
 *   HeroBaseComponent.StartUpgrading -> item.upgradeTime = now + UpgradeTimeH * 3600
 *                                       (finished by ConstructionUtils, which already walks
 *                                       village.buildings, so no extra hook is needed)
 *   level.HasFreeWorkers             -> not enforced: ACS does not track builders (502 neither)
 *
 * DATA: ACS ships no hero table. Drop the client's heroes.csv into Gamefiles/csv/ (same format
 * as characters.csv: one named row per hero, one row per level, UpgradeTimeH / UpgradeResource /
 * UpgradeCost on the row of the level being upgraded FROM; blank UpgradeCost = max level).
 * Row order = hero id: row 0 -> 28000000 (Barbarian King), row 1 -> 28000001 (Archer Queen).
 * Without heroes.csv the upgrade is applied instantly and free, as the old stub did.
 */
const fs = require('fs')
const path = require('path')
const Utils = require('../../../Utilities/Utils')
const CSVManager = require('../../../Core/CSVManager')
const { nowSeconds } = require('../../../Core/ConstructionUtils')
const { xpForSeconds } = require('../../../Core/ExperienceUtils')

const HERO_CSV = path.join(__dirname, '..', '..', '..', 'Gamefiles', 'csv', 'heroes.csv')
const MAX_LEVEL_INDEX = 99 // sanity cap only; the data decides the real maximum

// altar building global id -> { hero index (heroes.csv row), slot (1 = King, 2 = Queen) }
const ALTARS = {
  1000022: { hero: 0, slot: 1 }, // Barbarian King
  1000025: { hero: 1, slot: 2 } // Archer Queen
}

let heroTable = null // Array<Array<levelRow>> or [] when heroes.csv is absent

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

// Grouped per hero. Blank cells inherit the value of the row above (UpgradeResource is only filled on a
// hero's first row and UpgradeTimeH stops at 168), EXCEPT UpgradeCost: a blank UpgradeCost on the last
// row means max level, so it must stay blank.
const NO_INHERIT = new Set(['UpgradeCost'])

function loadHeroTable () {
  if (heroTable) return heroTable
  heroTable = []
  try {
    const rows = parseCsv(fs.readFileSync(HERO_CSV, 'utf8')).filter(r => r.length > 1)
    const headers = rows[0]
    let current = null
    for (let i = 2; i < rows.length; i++) { // row 1 is the type row
      if (rows[i][0]) { current = []; heroTable.push(current) }
      if (!current) continue
      const prev = current[current.length - 1]
      const lvl = {}
      headers.forEach((h, k) => {
        const cell = rows[i][k]
        lvl[h] = (cell === undefined || cell === '') && prev && !NO_INHERIT.has(h) ? prev[h] : cell
      })
      current.push(lvl)
    }
  } catch (e) {
    heroTable = [] // no heroes.csv
  }
  return heroTable
}

class LogicUpgradeHeroCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.HeroID = self.readInt() // hero altar building global id
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 527
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[LogicUpgradeHeroCommand] ${msg}`) }
    if (!player) return -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const id = this.data.HeroID
    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    if (!item) return log(`building ${id} not found`), -1

    const altar = ALTARS[item.data]
    if (!altar) return log(`building ${id} (${item.data}) is not a hero altar`), -1

    // IsLocked: the altar itself is still being built. Having the altar in the village is what unlocks
    // the hero. player.heroes is only a derived slot count (set when an altar is placed, and only in
    // BK-then-Queen order), so it is NOT trusted for this check: accounts whose altar exists but whose
    // counter is too low would have every upgrade rejected and snap back to level 1.
    if (item.buildTime) return log(`hero ${altar.hero} is locked (altar under construction)`), -23

    // Repair the slot count ClientAvatar uses to list heroes (1 = King, 2 = King + Queen).
    const hasKing = village.buildings.some(b => b && b.data === 1000022)
    const hasQueen = village.buildings.some(b => b && b.data === 1000025)
    const slots = hasKing ? (hasQueen ? 2 : 1) : 0
    if ((player.heroes || 0) < slots) {
      log(`player.heroes was ${player.heroes || 0} but the village has ${slots} hero altar(s); fixing`)
      player.heroes = slots
      player.markModified('heroes')
    }

    // CanStartUpgrading: one upgrade at a time
    if (item.upgradeTime) return log(`hero ${altar.hero} is already upgrading`), -1

    const level = item.lvl || 0
    if (level + 1 > MAX_LEVEL_INDEX) return log('already at max level'), -1

    const group = loadHeroTable()[altar.hero]
    const row = group ? group[Math.min(level, group.length - 1)] : null
    let seconds = 0

    if (row) {
      // Max level: last row (or any row) without an UpgradeCost
      const cost = parseInt(row.UpgradeCost, 10) || 0
      if (level >= group.length - 1 || cost <= 0) return log(`hero ${altar.hero} is already at max level (${level + 1})`), -1

      const field = CSVManager.resourceField(row.UpgradeResource) || (row.UpgradeResource === 'DarkElixir' ? 'darkMana' : null)
      if (!field) return log(`unknown upgrade resource "${row.UpgradeResource}"`), -1
      if ((player[field] || 0) < cost) return log(`not enough ${row.UpgradeResource} (${player[field]} < ${cost})`), -1

      player[field] -= cost // CommodityCountChangeHelper(-cost)
      player.markModified(field)
      seconds = Math.round((parseFloat(row.UpgradeTimeH) || 0) * 3600)
    } else {
      log('no heroes.csv data for this hero; applying the upgrade for free and instantly')
    }

    if (seconds > 0) {
      item.upgradeTime = nowSeconds() + seconds // StartUpgrading
      item.upgradeXp = xpForSeconds(seconds) // awarded on completion by ConstructionUtils
    } else {
      item.lvl = level + 1
    }

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`hero ${altar.hero} -> level ${level + 2}${seconds > 0 ? ` (${seconds}s)` : ' (instant)'}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicUpgradeHeroCommand
module.exports.loadHeroTable = loadHeroTable // used by LogicCancelHeroUpgradeCommand
module.exports.ALTARS = ALTARS
