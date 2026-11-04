class LogicCastSpellCommand {
  async decode (self) {
    this.data = {}

    this.data.SpellX = self.readInt()
    this.data.SpellY = self.readInt()
    this.data.SpellID = self.readInt()
    this.data.Unknown = self.readInt()
    this.data.Unknown2 = self.readByte() // BYTE (coc-messages: 604)
    this.data.Tick = self.readInt()

    //console.log(this.data)
  }

  async process (self) {
    self.client.attackDeployed = true
    ;(self.client.battleEvents = self.client.battleEvents || []).push({ tick: this.data.Tick, type: 'spell', x: this.data.SpellX, y: this.data.SpellY, id: this.data.SpellID })
    const player = self.client.player
    if (!player.spells) player.spells = []

    const spellIndex = player.spells.findIndex(u => u.unitID === this.data.SpellID)
    if (spellIndex !== -1) {
      const spell = player.spells[spellIndex]
      spell.count -= 1
      if (spell.count <= 0) player.spells.splice(spellIndex, 1)
      player.markModified('spells')
      await player.save()
    }
  }
}

module.exports = LogicCastSpellCommand