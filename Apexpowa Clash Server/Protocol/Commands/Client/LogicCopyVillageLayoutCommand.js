class LogicCopyVillageLayoutCommand {
  async decode (self) {
    this.data = {
      Tick: self.readInt(),
      CopiedLayout: self.readInt(),
      PasteLayout: self.readInt()
    }
  }

  async process (self) {
    let village
    try {
      village = JSON.parse(self.client.player.village || '{}')
    } catch {
      return
    }
    if (!village.layouts) village.layouts = {}
    const source = village.layouts[this.data.CopiedLayout] || []
    village.layouts[this.data.PasteLayout] = JSON.parse(JSON.stringify(source))
    self.client.player.village = JSON.stringify(village)
    self.client.player.markModified('village')
    await self.client.player.save()
  }
}

module.exports = LogicCopyVillageLayoutCommand