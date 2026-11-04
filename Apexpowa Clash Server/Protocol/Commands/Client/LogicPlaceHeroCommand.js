class LogicPlaceHeroCommand {
  async decode (self) {
    this.data = {}

    this.data.PositionX = self.readInt()
    this.data.PositionY = self.readInt()
    this.data.HeroID = self.readInt()
    this.data.Unknown = self.readInt()

    //console.log(this.data)
  }

  async process (self) {
    self.client.attackDeployed = true
    ;(self.client.battleEvents = self.client.battleEvents || []).push({ tick: this.data.Unknown, type: 'hero', x: this.data.PositionX, y: this.data.PositionY, id: this.data.HeroID })
  }
}

module.exports = LogicPlaceHeroCommand