/**
 * Command 509 - CancelUnitProduction (the player removes troops from a barracks queue)
 *
 * Layout, taken from live client traffic (the same 6 values as LogicTrainUnitCommand):
 *   INT buildingId, INT isSpell (0 = troop), INT unitType (4xxxxxx), INT count, INT unknown (0), INT tick
 *   e.g. 1d cd 65 05 | 00 00 00 00 | 00 3d 09 03 | 00 00 00 01 | 00 00 00 00 | 00 00 08 7d
 *        = building 500000005, troop 4000003, 1 unit, tick 2173
 * A 5-value layout (no second unknown) is detected from the bytes left in the turn, like the train
 * command does.
 *
 * Removes that many units of that kind from the END of the barracks queue and gives the training
 * cost back (the price that was charged when they were queued).
 */
const Utils = require('../../../Utilities/Utils')
const TrainingQueue = require('../../../Core/TrainingQueue')

const MAX_COUNT = 10000 // sanity limit for a desynced stream

function normalizeUnitID (rawID, isSpell) {
  if (rawID >= 1000000) return rawID
  return (isSpell ? 26000000 : 4000000) + rawID
}

class LogicCancelUnitProductionCommand {
  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.IsSpell = self.readInt()
    this.data.UnitID = normalizeUnitID(self.readInt(), this.data.IsSpell)
    this.data.Count = self.readInt()

    const remaining = self.buffer.length - self.offset
    let sixValues
    if (remaining <= 4) sixValues = false
    else if (remaining === 8) sixValues = true
    else sixValues = self.buffer.readInt32BE(self.offset) === 0

    this.data.Unknown2 = sixValues ? self.readInt() : 0
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client && client.player
    const log = (msg) => client.log(`LogicCancelUnitProductionCommand: ${msg}`)
    if (!player) return -1

    const { BuildingID, UnitID, Count } = this.data
    if (!Number.isInteger(Count) || Count <= 0 || Count > MAX_COUNT) return log(`ignored invalid count ${Count}`), -1
    if (Utils.getClassID(BuildingID) !== 500) return log(`unsupported object class for id ${BuildingID}`), -1

    await TrainingQueue.resolvePlayer(player) // what already finished stays finished

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }
    const building = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(BuildingID)] : null
    if (!building) return log(`building ${BuildingID} not found`), -1

    const removed = TrainingQueue.cancel(building, UnitID, Count)
    if (removed <= 0) return log(`nothing to cancel: ${UnitID} is not in the queue of building ${BuildingID}`), 0

    const refunded = TrainingQueue.refund(player, UnitID, removed)
    player.village = JSON.stringify(village)
    player.markModified('village')
    TrainingQueue.invalidate(player)
    await player.save()
    log(`cancelled ${removed} x ${UnitID}${refunded ? `, refunded ${refunded}` : ''}`)
    return 0
  }
}

module.exports = LogicCancelUnitProductionCommand
