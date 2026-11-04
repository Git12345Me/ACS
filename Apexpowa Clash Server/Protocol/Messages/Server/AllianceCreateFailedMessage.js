const PiranhaMessage = require("../../PiranhaMessage")

class AllianceCreateFailedMessage extends PiranhaMessage {
  /**
   * reason: 0 = generic, 1 = invalid name, 2 = name too short,
   * 3 = name too long, 4 = name taken
   * (reason codes are unverified - check against your client build)
   */
  constructor (client, reason = 0) {
    super()
    this.id = 24332
    this.client = client
    this.version = 1
    this.reason = reason
  }

  async encode () {
    this.writeInt(this.reason)
  }
}

module.exports = AllianceCreateFailedMessage
