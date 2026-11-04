const PiranhaMessage = require('../../PiranhaMessage')

class KickAllianceMemberOkMessage extends PiranhaMessage {
  constructor (client, highID, lowID) {
    super()
    this.id = 24307
    this.client = client
    this.version = 1
    this.highID = highID
    this.lowID = lowID
  }

  async encode () {
    this.writeLong(this.highID, this.lowID) // Kicked member AvatarId
  }
}

module.exports = KickAllianceMemberOkMessage
