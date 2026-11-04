const PiranhaMessage = require('../../PiranhaMessage')

// 24117 (this client's number): INT sub tick, INT command count, the commands (each = command id INT + body, as the
// client sends them in EndClientTurn). `commands` are the raw buffers copied from the attacker's packets.
class LiveReplayDataMessage extends PiranhaMessage {
  constructor (client, subTick, commands) {
    super()
    this.id = 24117
    this.client = client
    this.version = 1
    this.subTick = subTick || 0
    this.commands = commands || []
  }

  async encode () {
    this.writeInt(this.subTick)
    this.writeInt(this.commands.length)
    for (const c of this.commands) this.writeBytesWithoutLength(c)
  }
}

module.exports = LiveReplayDataMessage
