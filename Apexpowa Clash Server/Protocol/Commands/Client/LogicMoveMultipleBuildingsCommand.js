const Utils = require('../../../Utilities/Utils')

class LogicMoveMultipleBuildingsCommand {
  async decode (self) {
    this.data = {}
    
    this.data.Objects = []
    this.data.Count = self.readInt()
    for (let i = 0; i < this.data.Count; i++) this.data.Objects.push({x: self.readInt(), y: self.readInt(), id: self.readInt()})
    self.readInt()

    //console.log(this.data)
  }

  async process (self) {
    let village = JSON.parse(self.client.player.village)
    if (!Array.isArray(village.buildings)) village.buildings = []
    if (!Array.isArray(village.decos)) village.decos = []
    if (!Array.isArray(village.traps)) village.traps = []

    for (const obj of this.data.Objects) {
      const instanceID = Utils.getInstanceID(obj.id)
      let found = false

      // by class (500 building, 504 trap, 506 deco), not by the instance number in every list
      const list = { 500: village.buildings, 504: village.traps, 506: village.decos }[Utils.getClassID(obj.id)]
      const item = list && list[instanceID]
      if (item) {
        item.x = obj.x
        item.y = obj.y
        found = true
      }

      if (!found) console.log(`[LogicMoveMultipleBuildingsCommand] ${obj.id} not found`)
    }

    self.client.player.village = JSON.stringify(village)
    self.client.player.markModified('village')
    await self.client.player.save()
  }
}

module.exports = LogicMoveMultipleBuildingsCommand