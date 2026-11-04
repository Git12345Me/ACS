// SaveUnitPreset: the player saves one of the three "quick train" armies.
//
// Layout (C# Decode): INT presetId (1, 2 or 3), INT slotCount, slotCount x
// { INT unitID (4xxxxxx troop / 26xxxxxx spell), INT count }, INT tick.
// The slot layout (global id + count, like the avatar's unit slots) is assumed:
// the C# LogicDataSlot.Decode is not part of what was provided.
//
// Execute (ported): for every troop in characters.csv, in table order, the count is
// kept only if the army still fits the player's troop housing (the sum of the
// Troop Housing buildings) and the troop is unlocked (BarrackLevel <= highest Barrack
// level); everything after the first overflow is saved as 0, as in the C#.
// Secondary troops (golemites, skeletons...) are skipped.
// Differences: spells have no usable data (spells.csv is a copy of the troop csv), so
// their counts are saved as sent; and the EnablePresets / town hall globals do not
// exist in ACS's globals.csv, so they are not checked.
//
// Saved in the village JSON, read by LogicTrainQuickUnitsCommand:
//   village.quick_train = { "1": [{ "unitID": 4000000, "count": 20 }, ...], "2": [...], "3": [...] }
//
// Needs 'characters' in TABLE_FILES in Core/CSVManager.js. The command id is not in
// the protocol wiki's list: when the client sends it ACS logs
// "Gotcha undefined <id> command!" - register that id in EndClientTurnMessage.js.
// ACS also does not send saved presets back in the avatar, so a client that shows
// them will start empty after a re-login.
const CSVManager = require('../../../Core/CSVManager')

const TROOP_HOUSING_DATA_ID = 1000000 // "Troop Housing" in buildings.csv
const BARRACK_DATA_ID = 1000006 // "Barrack" in buildings.csv
const CHARACTER_CLASS = 4
const SPELL_CLASS = 26
const MAX_SLOTS = 200 // sanity limit for a desynced stream

class LogicSaveUnitPresetCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.PresetID = self.readInt()
    const size = self.readInt()
    this.data.Slots = []

    if (size < 0 || size > MAX_SLOTS) {
      if (self.client && typeof self.client.log === 'function') {
        self.client.log(`[LogicSaveUnitPresetCommand] invalid slot count ${size}, skipping rest of turn`)
      }
      this.data.Invalid = true
      self.offset = self.buffer.length // layout is wrong: drop the rest of the turn
      return
    }

    for (let i = 0; i < size; i++) {
      this.data.Slots.push({ unitID: self.readInt(), count: self.readInt() })
    }
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 0 // SAVE_UNIT_PRESET: id unknown for this client, see header
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (text) => {
      if (client && typeof client.log === 'function') client.log(`[LogicSaveUnitPresetCommand] ${text}`)
    }
    if (!player || this.data.Invalid) return -1

    const { PresetID, Slots } = this.data
    if (PresetID < 1 || PresetID > 3) return log(`ignored invalid preset ${PresetID}`), -2

    if (!CSVManager.getRowGroup('characters', 4000000)) {
      return log("no characters data: add 'characters' to TABLE_FILES in Core/CSVManager.js"), -1
    }

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }
    const buildings = Array.isArray(village.buildings) ? village.buildings : []

    // Total troop housing and highest Barrack level (finished buildings only).
    let totalMaxHousing = 0
    let barrackLevel = 0
    for (const b of buildings) {
      if (!b || b.buildTime) continue
      if (b.data === TROOP_HOUSING_DATA_ID) {
        const row = CSVManager.getLevelData('buildings', b.data, b.lvl || 0)
        totalMaxHousing += (row && row.HousingSpace) || 0
      } else if (b.data === BARRACK_DATA_ID) {
        barrackLevel = Math.max(barrackLevel, (b.lvl || 0) + 1)
      }
    }

    const wanted = new Map() // unitID -> count (last one wins, like the C# search by data)
    for (const s of Slots) {
      if (Number.isInteger(s.unitID) && Number.isInteger(s.count) && s.count > 0) wanted.set(s.unitID, s.count)
    }

    const preset = []
    let housingSpace = 0 // running total as in the C#: keeps growing once the army no longer fits
    let savedHousing = 0
    for (let index = 0; ; index++) {
      const unitID = CHARACTER_CLASS * 1000000 + index
      const group = CSVManager.getRowGroup('characters', unitID)
      if (!group) break
      const row = group[0]
      if (String(row.IsSecondaryTroop).toUpperCase() === 'TRUE' || row.IsSecondaryTroop === true) continue

      const count = wanted.get(unitID) || 0
      housingSpace += count * (row.HousingSpace || 1)
      const unlocked = barrackLevel >= (row.BarrackLevel || 1)
      if (count > 0 && housingSpace <= totalMaxHousing && unlocked) {
        preset.push({ unitID, count })
        savedHousing += count * (row.HousingSpace || 1)
      }
    }

    for (const [unitID, count] of wanted) { // spells: no data, kept as sent
      if (Math.floor(unitID / 1000000) === SPELL_CLASS) preset.push({ unitID, count })
    }

    if (!village.quick_train || typeof village.quick_train !== 'object') village.quick_train = {}
    village.quick_train[PresetID] = preset
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`preset ${PresetID} saved: ${preset.length} unit types, housing ${savedHousing}/${totalMaxHousing}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicSaveUnitPresetCommand
