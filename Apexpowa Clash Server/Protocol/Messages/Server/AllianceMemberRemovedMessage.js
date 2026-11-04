const PiranhaMessage = require('../../PiranhaMessage')

class AllianceMemberRemovedMessage extends PiranhaMessage {
  constructor (client, highID, lowID) {
    super()
    this.id = 24309
    this.client = client
    this.version = 1
    this.highID = highID
    this.lowID = lowID
  }

  async encode () {
    this.writeLong(this.highID, this.lowID) // Removed member AvatarId
  }
}

module.exports = AllianceMemberRemovedMessage
