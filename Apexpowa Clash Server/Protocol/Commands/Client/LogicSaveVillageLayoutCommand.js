class LogicSaveVillageLayoutCommand {
  async decode (self) {
    this.data = {
      Layout: self.readInt(),
      Unknown: self.readInt(),
      Save: self.readByte(),
      Tick: self.readInt()
    }
  }

  async process (self) {
    // Building movement commands already write the active village. This
    // command is the client's commit point, so make that write awaitable.
    if (self.client.player?.save) await self.client.player.save()
  }
}

module.exports = LogicSaveVillageLayoutCommand