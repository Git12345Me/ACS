const PiranhaMessage = require('../../PiranhaMessage')

class DisconnectedMessage extends PiranhaMessage {
  constructor (client, reason = 0) {
    super()
    this.id = 25892
    this.client = client
    this.version = 1
    this.reason = reason
  }

  async encode () {
    this.writeInt(this.reason) // Disconnect reason
  }
}

module.exports = DisconnectedMessage
