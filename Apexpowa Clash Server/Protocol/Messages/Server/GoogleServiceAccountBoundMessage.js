const PiranhaMessage = require("../../PiranhaMessage")

class GoogleServiceAccountBoundMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24261
    this.client = client
    this.version = 1
  }

  async encode () {
    this.writeInt(1)
  }
}

module.exports = GoogleServiceAccountBoundMessage
