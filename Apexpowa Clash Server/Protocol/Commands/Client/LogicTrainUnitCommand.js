/**
 * Command 508 - TrainUnit
 *
 * Port of the C# TrainUnitCommand (Packet 508).
 *
 * C# layout:  INT buildingId, INT isSpell (0 = troop), INT unitType, INT count,
 *             UINT unknown, INT tick                      (6 values)
 * The coc-messages definition for this client lists only 5 values (no second
 * unknown). Which one a given client build sends has not been captured, so
 * decode() detects it from the bytes that are left in the turn and logs the
 * result. A wrong guess would desync the rest of the turn, so it is based on
 * two facts: a tick is never 0, and the unknown value is 0 in the captured
 * 509/550 packets of the same shape.
 *
 * Behaviour:
 *   - unitType 4xxxxxx (class 4)   -> troop, added to player.army
 *   - unitType 26xxxxxx (class 26) -> spell, added to player.spells
 *   - troop costs come from characters.csv and are charged when queued.
 *   - spells have no usable timing/cost table in this archive. The three basic
 *     spells use approximate 2014 brew times from TrainingQueue; spell costs
 *     remain free as in the previous implementation, and unknown spells remain
 *     instant.
 * Training times are kept in the named building's production queue and survive
 * restarts. Troops queue in troop factories; timed spells queue in Spell Factory.
 */
const fs = require('fs')
const path = require('path')
const Utils = require('../../../Utilities/Utils')
const TrainingQueue = require('../../../Core/TrainingQueue')

const RESOURCE_FIELD = {
  Gold: 'gold',
  Elixir: 'mana',
  DarkElixir: 'darkMana'
}

const MAX_COUNT = 10000 // sanity limit for a desynced stream

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

let trainingCosts = null // Map<unitIndex, { resource, cost }>

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

/** Level 0 training resource / cost per troop index (first row of each unit). */
function loadTrainingCosts () {
  if (trainingCosts) return trainingCosts
  trainingCosts = new Map()

  try {
    const file = path.join(__dirname, '../../../Gamefiles/csv/characters.csv')
    const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const header = rows[0]
    const nameCol = header.indexOf('Name')
    const costCol = header.indexOf('TrainingCost')
    const resCol = header.indexOf('TrainingResource')

    let index = -1
    for (const row of rows.slice(2)) { // row 1 holds the column types
      if (row[nameCol]) {
        index++
        trainingCosts.set(index, { resource: row[resCol], cost: parseInt(row[costCol], 10) || 0 })
      }
    }
  } catch (e) {
    console.error('LogicTrainUnitCommand: unable to read characters.csv', e.message)
  }

  return trainingCosts
}

class LogicTrainUnitCommand {
  async decode (self) {
    this.data = {}

    this.data.BuildingID = self.readInt()
    this.data.IsSpell = self.readInt() // 0 = troop, otherwise spell
    this.data.UnitID = normalizeUnitID(self.readInt(), this.data.IsSpell)
    this.data.Count = self.readInt()

    const remaining = self.buffer.length - self.offset
    let sixValues
    if (remaining <= 4) sixValues = false
    else if (remaining === 8) sixValues = true
    else sixValues = self.buffer.readInt32BE(self.offset) === 0

    this.data.Unknown2 = sixValues ? self.readInt() : 0
    this.data.Tick = self.readInt()
    this.data.Layout = sixValues ? 6 : 5
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const { UnitID, Count } = this.data

    if (!player) return

    await TrainingQueue.resolvePlayer(player) // finish what is already done before changing the queue

    if (!Number.isInteger(Count) || Count <= 0 || Count > MAX_COUNT) {
      client.log(`LogicTrainUnitCommand: ignored invalid count ${Count}`)
      return
    }

    const classID = Math.floor(UnitID / 1000000)
    const listName = classID === 4 ? 'army' : classID === 26 ? 'spells' : null
    if (listName && (classID === 26) !== (this.data.IsSpell !== 0)) {
      client.log(`LogicTrainUnitCommand: isSpell=${this.data.IsSpell} does not match unit ${UnitID}, using the unit id`)
    }

    if (!listName) {
      client.log(`LogicTrainUnitCommand: ignored unknown unit type ${UnitID}`)
      return
    }

    // Queue timed troops in troop factories and timed spells in Spell Factory.
    let queued = false
    const BuildingID = this.data.BuildingID
    if (TrainingQueue.trainSeconds(UnitID) > 0 && Utils.getClassID(BuildingID) === 500) {
      try {
        const village = JSON.parse(player.village)
        const building = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(BuildingID)] : null
        const expectedType = classID === 26 ? 1 : 0
        const correctFactory = building && building.unit_prod && Number(building.unit_prod.unit_type) === expectedType
        if (correctFactory && TrainingQueue.enqueue(building, UnitID, Count)) {
          player.village = JSON.stringify(village)
          player.markModified('village')
          TrainingQueue.invalidate(player)
          queued = true
        }
      } catch (e) {
        client.log(`LogicTrainUnitCommand: could not queue (${e.message}), granting at once`)
      }
    }

    if (!queued) {
      if (!Array.isArray(player[listName])) player[listName] = []

      const existing = player[listName].find(u => Number(u.unitID) === UnitID)
      if (existing) {
        existing.count = (Number(existing.count) || 0) + Count
      } else {
        player[listName].push({ unitID: UnitID, count: Count })
      }
      player.markModified(listName)
    }

    // Training cost (troops only; this archive has no usable spell cost table).
    let charged = ''
    if (classID === 4) {
      const entry = loadTrainingCosts().get(UnitID - 4000000)
      const field = entry && RESOURCE_FIELD[entry.resource]

      if (field && entry.cost > 0) {
        const cost = entry.cost * Count
        player[field] = Math.max(0, (Number(player[field]) || 0) - cost)
        player.markModified(field)
        charged = `, charged ${cost} ${entry.resource}`
      }
    }

    await player.save()

    client.log(
      `LogicTrainUnitCommand: ${queued ? 'queued' : 'trained'} ${Count} x ${UnitID}${charged} (${this.data.Layout}-value layout)`
    )
  }
}

module.exports = LogicTrainUnitCommand
