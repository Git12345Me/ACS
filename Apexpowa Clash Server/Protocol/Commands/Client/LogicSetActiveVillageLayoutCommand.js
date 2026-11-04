class LogicSetActiveVillageLayoutCommand {
  async decode (self) {
    this.data = { Layout: self.readInt(), Unknown: self.readInt(), Tick: self.readInt() }
  }

  async process (self) {
    let village
    try {
      village = JSON.parse(self.client.player.village || '{}')
    } catch {
      return
    }
    const layout = Number(this.data.Layout)
    if (!Number.isInteger(layout) || layout < 0 || layout > 2) return
    village.activeLayout = layout
    self.client.player.village = JSON.stringify(village)
    self.client.player.markModified('village')
    await self.client.player.save()
  }
}

module.exports = LogicSetActiveVillageLayoutCommand