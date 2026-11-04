const PiranhaMessage = require('../../PiranhaMessage')

// 24118: INT code - 1 = TID_LIVE_REPLAY_FAIL_NO_DATA_FOUND, 2 = ..._NO_FREE_SLOTS, anything else = generic failure
class LiveReplayFailedMessage extends PiranhaMessage {
  constructor (client, code) {
    super()
    this.id = 24118
    this.client = client
    this.version = 1
    this.code = code || 1
  }

  async encode () {
    this.writeInt(this.code)
  }
}

module.exports = LiveReplayFailedMessage
