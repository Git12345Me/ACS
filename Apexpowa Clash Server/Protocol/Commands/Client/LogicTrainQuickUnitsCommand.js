// TrainQuickUnitsCommand: trains one of the three saved "quick train" armies at once.
//
// Layout (C# Decode): INT dataSlotID (1, 2 or 3), INT tick.
//
// C# Process: adds every unit of player.QuickTrain1 / 2 / 3 to the player's units
// (existing slot +count, otherwise a new slot). Like the C#, nothing is charged.
//
// ACS has no QuickTrain1/2/3 on the player, so the saved armies are read from the
// village JSON (no database change):
//   village.quick_train = { "1": [{ "unitID": 4000000, "count": 20 }, ...], "2": [...], "3": [...] }
// Units go to player.army, spells (26xxxxxx) to player.spells, as LogicTrainUnitCommand does.
//
// NOT wired up: nothing in ACS saves these armies yet, and the command id is not
// in the protocol wiki's list (this build may not send the command at all). When
// the client sends it, ACS logs "Gotcha undefined <id> command!" - register that
// id in EndClientTurnMessage.js.
const CHARACTER_CLASS = 4
const SPELL_CLASS = 26

class LogicTrainQuickUnitsCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.DataSlotID = self.readInt()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 0 // id unknown for this client, see header
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (text) => {
      if (client && typeof client.log === 'function') client.log(`[LogicTrainQuickUnitsCommand] ${text}`)
    }
    if (!player) return -1

    const slotID = this.data.DataSlotID
    if (slotID !== 1 && slotID !== 2 && slotID !== 3) return log(`ignored invalid quick train slot ${slotID}`), -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const preset = village.quick_train && village.quick_train[slotID]
    if (!Array.isArray(preset) || preset.length === 0) return log(`quick train ${slotID} is empty`), 0

    let added = 0
    for (const item of preset) {
      const unitID = Number(item && item.unitID)
      const count = Number(item && item.count)
      if (!Number.isInteger(unitID) || !Number.isInteger(count) || count <= 0) continue

      const classID = Math.floor(unitID / 1000000)
      const listName = classID === CHARACTER_CLASS ? 'army' : classID === SPELL_CLASS ? 'spells' : null
      if (!listName) continue

      if (!Array.isArray(player[listName])) player[listName] = []
      const existing = player[listName].find(u => Number(u.unitID) === unitID)
      if (existing) existing.count = (Number(existing.count) || 0) + count
      else player[listName].push({ unitID, count })
      player.markModified(listName)
      added += count
    }

    await player.save()
    log(`quick train ${slotID}: added ${added} units`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicTrainQuickUnitsCommand
