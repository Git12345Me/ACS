/**
 * Commands the client queues around a war battle (wars.md section 3/4):
 *   607: queued before loading a war battle, body = int subTick
 *   608: queued after 24326, enables troop deployment in the client's copy of the battle.
 *        Body: int marker (+ string when >= 0) x2, int n, n x (dataref unit, int, int), int subTick
 * ACS runs no battle, so both are only consumed to keep the rest of the turn aligned.
 */
class LogicWarBattleStartCommand { // 607
  async decode (self) { this.data = { Tick: self.readInt() } }
  async process () {}
}

class LogicWarAttackDataCommand { // 608
  async decode (self) {
    this.data = {}
    this.data.HasJson1 = self.readInt() >= 0
    if (this.data.HasJson1) this.data.Json1 = self.readString()
    this.data.HasJson2 = self.readInt() >= 0
    if (this.data.HasJson2) this.data.Json2 = self.readString()
    const n = self.readInt()
    this.data.Units = []
    for (let i = 0; i < Math.min(Math.max(n, 0), 64); i++) this.data.Units.push([self.readInt(), self.readInt(), self.readInt()])
    this.data.Tick = self.readInt()
  }

  async process () {}
}

module.exports = { LogicWarBattleStartCommand, LogicWarAttackDataCommand }
