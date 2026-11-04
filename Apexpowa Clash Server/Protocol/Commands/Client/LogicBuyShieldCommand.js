const ShieldData = {
  20000000: { TimeH: 24, Diamonds: 100 },
  20000001: { TimeH: 48, Diamonds: 250 },
  20000002: { TimeH: 168, Diamonds: 500 }
}

class LogicBuyShieldCommand {
  async decode (self) {
    this.data = {}

    this.data.ShieldId = self.readInt()
    self.readInt()

    //console.log(this.data)
  }

  async process (self) {
    const shield = ShieldData[this.data.ShieldId]
    if (!shield) return

    // Epoch SECONDS: the column is a 32-bit INT, which cannot hold milliseconds (they were lost on save).
    const now = Math.floor(Date.now() / 1000)
    const saved = Number(self.client.player.shieldDurationSeconds) || 0
    const current = saved > 1e11 ? Math.floor(saved / 1000) : saved
    const time = current > now ? current : now
    self.client.player.shieldDurationSeconds = time + shield.TimeH * 3600
    self.client.player.shieldReduceStep = 0 // a new shield starts the attack reduction again
    self.client.player.diamonds -= shield.Diamonds

    self.client.player.markModified('shieldDurationSeconds')
    self.client.player.markModified('diamonds')
    await self.client.player.save()
  }
}

module.exports = LogicBuyShieldCommand