const Utils = require('../../../Utilities/Utils')

class LogicEditVillageLayoutCommand {
  async decode (self) {
    // This client sends 22 bytes (decoded from the logged turns, e.g. for building 1dcd6501):
    //   INT x, INT y (both -1 = no position), INT building id, BYTE flag A, INT layout, BYTE flag B, INT tick.
    // Reading 5 INTs (20 bytes) left the last 2 bytes of the tick in the stream; they were read as the next command id
    // (224657408, 232652800, ...) and the rest of the turn was dropped.
    this.data = {}
    this.data.PositionX = self.readInt()
    this.data.PositionY = self.readInt()
    this.data.BuildingID = self.readInt()
    this.data.FlagA = self.readByte()
    this.data.Layout = self.readInt()
    this.data.FlagB = self.readByte()
    this.data.Tick = self.readInt()
  }

  async process (self) {
    let village
    try {
      village = JSON.parse(self.client.player.village || '{}')
    } catch {
      return
    }
    if (!Array.isArray(village.buildings)) return

    // -1 / -1 is "no position" (it is how the game removes a building from a layout), not a place to put it:
    // saving it moved the building to -1,-1.
    if (this.data.PositionX < 0 || this.data.PositionY < 0) {
      self.client.log(`[LogicEditVillageLayoutCommand] building ${this.data.BuildingID}: no position (${this.data.PositionX},${this.data.PositionY}), layout ${this.data.Layout}, flags ${this.data.FlagA}/${this.data.FlagB} - not moved`)
      return
    }

    const instanceID = Utils.getInstanceID(this.data.BuildingID)
    const building = village.buildings[instanceID]
    if (!building) return

    // The port has one persisted home, so preserve non-active layout edits
    // separately instead of accidentally moving the active base.
    if (this.data.Layout === 0) {
      building.x = this.data.PositionX
      building.y = this.data.PositionY
    } else {
      if (!village.layouts) village.layouts = {}
      if (!Array.isArray(village.layouts[this.data.Layout])) {
        village.layouts[this.data.Layout] = []
      }
      const item = village.layouts[this.data.Layout].find(entry =>
        Number(entry.id) === Number(this.data.BuildingID)
      )
      if (item) {
        item.x = this.data.PositionX
        item.y = this.data.PositionY
      } else {
        village.layouts[this.data.Layout].push({
          id: this.data.BuildingID,
          x: this.data.PositionX,
          y: this.data.PositionY
        })
      }
    }

    self.client.player.village = JSON.stringify(village)
    self.client.player.markModified('village')
    await self.client.player.save()
  }
}

module.exports = LogicEditVillageLayoutCommand