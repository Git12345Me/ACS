const PiranhaMessage = require('../../PiranhaMessage')

// 14123: the "watch live" button (LONG, INT, LONG - libg.so 0x1292f6). Which long is the attacker is not known, so
// both are tried (a war attack is looked up by the attacker's avatar id or by the defender's).
class AskLiveReplayMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14123
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.First = this.readLong()
    this.data.Mode = this.readInt()
    this.data.Second = this.readLong()
  }

  async process () {
    this.client.log(`[Logic] live replay: request ${this.data.First.join('-')} / ${this.data.Mode} / ${this.data.Second.join('-')}`)
    await require('../../../Core/LiveReplay').watch(this.client, [this.data.First, this.data.Second])
  }
}

module.exports = AskLiveReplayMessage
