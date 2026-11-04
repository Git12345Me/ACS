const Utils = require('../../../Utilities/Utils')
const Obstacles = require('../../../Core/Obstacles')
const { nowSeconds } = require('../../../Core/ConstructionUtils')

// Game object ID of an obstacle = 503000000 + its index in village.obstacles,
// numbered by the client when it loads the village JSON.
const OBSTACLE_CLASS = 503

class LogicClearObstacleCommand {
  async decode (self) {
    this.data = {}

    this.data.ObstacleID = self.readInt()
    this.data.Unknown = self.readInt()
  }

  async process (self) {
    // TODO: Clear obstacle time, for now it will instantly clear
    const client = self.client
    const classID = Utils.getClassID(this.data.ObstacleID)
    const instanceID = Utils.getInstanceID(this.data.ObstacleID)
    if (classID !== OBSTACLE_CLASS) {
      client.log(`[LogicClearObstacleCommand] ${this.data.ObstacleID} is not an obstacle id (class ${classID})`)
      return
    }

    const village = JSON.parse(client.player.village)
    if (!Array.isArray(village.obstacles)) village.obstacles = []

    // The client keeps the IDs it was given when the village was sent, so the
    // numbering must not shift when one obstacle is removed. Keep the original
    // order for this session and only drop cleared entries from what is saved.
    // (Splicing the array directly made every later obstacle's ID point at its
    // neighbour, or past the end, after the first clear.)
    const live = JSON.stringify(village.obstacles)
    let slots = client.obstacleSlots
    if (!slots || JSON.stringify(slots.filter(s => !s.removed).map(s => s.obj)) !== live) {
      slots = village.obstacles.map(obj => ({ obj, removed: false }))
    }

    const slot = slots[instanceID]
    if (!slot || slot.removed) {
      client.log(`[LogicClearObstacleCommand] obstacle ${instanceID} not found (village has ${village.obstacles.length})`)
      return
    }
    // the live entry of village.obstacles (the cached slot may hold an older copy of it)
    const liveIndex = slots.slice(0, instanceID).filter(s => !s.removed).length
    const obstacle = village.obstacles[liveIndex]
    if (!obstacle) return client.log(`[LogicClearObstacleCommand] obstacle ${instanceID} is not in the saved village`)
    const now = nowSeconds()
    const seconds = Obstacles.clearSeconds(obstacle.data)

    // Start clearing: pay ClearCost and set the timer (obstacles.csv ClearTimeSeconds). A speed-up (505, finish = true) or a
    // zero clear time finishes it now: the obstacle is removed, its loot is given and respawning starts.
    if (!obstacle.clearEnd && !this.finish) {
      const cost = Obstacles.clearCost(obstacle.data)
      if (cost) {
        if ((client.player[cost.field] || 0) < cost.cost) {
          client.log(`[LogicClearObstacleCommand] not enough ${cost.resource} to clear obstacle ${instanceID}`)
          return
        }
        client.player[cost.field] -= cost.cost
        client.player.markModified(cost.field)
      }
      if (seconds > 0) {
        obstacle.clearEnd = now + seconds
        slot.obj = obstacle // keep the numbering of this session
        client.obstacleSlots = slots
        client.player.village = JSON.stringify(village)
        client.player.markModified('village')
        await client.player.save()
        client.log(`[LogicClearObstacleCommand] clearing obstacle ${instanceID} (data ${obstacle.data}) for ${seconds}s`)
        return
      }
    }

    slot.removed = true
    client.obstacleSlots = slots
    // finishClearing removes it from village.obstacles; the slots keep the numbering for this session
    const what = Obstacles.finishClearing(village, client.player, obstacle)
    client.player.village = JSON.stringify(village)
    client.player.markModified('village')
    await client.player.save()
    client.log(`[LogicClearObstacleCommand] ${what} (slot ${instanceID})`)
  }
}

module.exports = LogicClearObstacleCommand
