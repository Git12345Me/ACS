class LogicBuyResourceCommand {
  // Layout (from the logs):  INT resource data, INT amount, BYTE hasEmbeddedCommand,
  //   [ INT embedded command id + that command's own data ]   <- only when the byte is 1, then INT tick
  // The client wraps "buy the missing resources" AROUND the action that needed them, e.g. 518 + 527 (upgrade hero).
  // The embedded command used to be skipped as an "unknown command", so those upgrades never reached the server and
  // the hero fell back to its old level after a reload.
  async decode (self) {
    this.data = {}
    this.nested = null

    this.data.ResourceData = self.readInt()
    this.data.ResourceCount = self.readInt()
    const hasEmbedded = self.readBoolean()

    if (hasEmbedded) {
      const nestedID = self.readInt()
      const Cmd = self.Commands && self.Commands[nestedID]
      if (!Cmd) throw new Error(`embedded command ${nestedID} has no handler`)
      this.nestedID = nestedID
      this.nested = new Cmd(self.client)
      await this.nested.decode(self)
      if (self.client && self.client.log) self.client.log(`[Logic] 518 carries embedded command ${nestedID} (${this.nested.constructor.name})`)
    }

    this.data.Tick = self.readInt()
  }

  async process (self) {
    await this.addResources(self)
    if (this.nested) await this.nested.process(self)
  }

  async addResources (self) {
    switch (this.data.ResourceData) {
      case 3000001:
        self.client.player.gold += this.data.ResourceCount
        self.client.player.markModified('gold')
        await self.client.player.save()
        break
      case 3000002:
        self.client.player.mana += this.data.ResourceCount
        self.client.player.markModified('mana')
        await self.client.player.save()
        break
      case 3000003:
        self.client.player.darkMana += this.data.ResourceCount
        self.client.player.markModified('darkMana')
        await self.client.player.save()
        break
    }
  }
}

module.exports = LogicBuyResourceCommand