const PiranhaMessage = require('../../PiranhaMessage')

class KickAllianceMemberMessage extends PiranhaMessage {
  constructor (client, highID = 0, lowID = 0) {
    super()
    this.id = 24307
    this.client = client
    this.version = 1
    this.highID = highID
    this.lowID = lowID
  }

  async encode () {
    this.writeLong(this.highID, this.lowID)
  }
}

module.exports = KickAllianceMemberMessage
