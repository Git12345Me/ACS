const Utils = require('../../../Utilities/Utils')

class LogicMoveBuildingCommand {
  async decode (self) {
    this.data = {}

    this.data.PositionX = self.readInt()
    this.data.PositionY = self.readInt()
    this.data.BuildingID = self.readInt()
    this.data.Unknown = self.readInt()

    //console.log(this.data)
  }

  async process (self) {
    let village = JSON.parse(self.client.player.village)
    if (!Array.isArray(village.buildings)) village.buildings = []
    if (!Array.isArray(village.decos)) village.decos = []
    if (!Array.isArray(village.traps)) village.traps = []
    const id = this.data.BuildingID
    const instanceID = Utils.getInstanceID(id)
    const x = this.data.PositionX
    const y = this.data.PositionY
    let moved = false

    // The class of the id says which list it is in (500 building, 504 trap, 506 deco). Looking the instance number up in
    // all three lists moved a deco and a trap that happened to have the same number as the building.
    const list = { 500: village.buildings, 504: village.traps, 506: village.decos }[Utils.getClassID(id)]
    const item = list && list[instanceID]
    if (item) {
      item.x = x
      item.y = y
      moved = true
    }

    if (moved) {
      self.client.player.village = JSON.stringify(village)
      self.client.player.markModified('village')
      await self.client.player.save()
    } else {
      console.log(`[LogicMoveBuildingCommand] ${id} not found (x ${x}, y ${y})`)
    }
  }
}

module.exports = LogicMoveBuildingCommand