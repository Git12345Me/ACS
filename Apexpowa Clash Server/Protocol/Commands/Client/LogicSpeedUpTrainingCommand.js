/**
 * Command 513 - SpeedUpTraining
 * Layout (taken from live client traffic): INT buildingId, INT tick
 *   e.g. 1d cd 65 0d | 00 00 01 0a  =  building 500000013, tick 266
 *
 * Finishes the whole training queue of that barracks now for gems (the standard time -> gems
 * curve on the time that is left). The units join the army. Not enough gems or nothing queued:
 * nothing changes.
 */
const Utils = require('../../../Utilities/Utils')
const TrainingQueue = require('../../../Core/TrainingQueue')

// Standard CoC time -> gems curve (identical to LogicBuyBuildingCommand).
function speedUpCost (seconds) {
  if (seconds <= 0) return 0
  if (seconds <= 60) return 1
  if (seconds <= 3600) return Math.floor((seconds - 60) * 19 / 3540 + 1)
  if (seconds <= 86400) return Math.floor((seconds - 3600) * 240 / 82800 + 20)
  return Math.floor((seconds - 86400) * 740 / 518400 + 260)
}

class LogicSpeedUpTrainingCommand {
  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client && client.player
    const log = (msg) => client.log(`LogicSpeedUpTrainingCommand: ${msg}`)
    if (!player) return -1

    const id = this.data.BuildingID
    if (Utils.getClassID(id) !== 500) return log(`unsupported object class for id ${id}`), -1

    await TrainingQueue.resolvePlayer(player)

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const building = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(id)] : null
    if (!building) return log(`building ${id} not found`), -1

    const seconds = TrainingQueue.remainingSeconds(building)
    if (seconds <= 0) return log(`building ${id} has nothing in training`), -1

    const cost = speedUpCost(seconds)
    if ((Number(player.diamonds) || 0) < cost) return log(`not enough gems (${player.diamonds} < ${cost})`), -1
    player.diamonds = (Number(player.diamonds) || 0) - cost
    player.markModified('diamonds')

    TrainingQueue.finishBuilding(building, player)
    player.village = JSON.stringify(village)
    player.markModified('village')
    TrainingQueue.invalidate(player)
    await player.save()
    log(`building ${id} finished for ${cost} gems (${seconds}s left)`)
    return 0
  }
}

module.exports = LogicSpeedUpTrainingCommand
