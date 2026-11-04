const PiranhaMessage = require('../../PiranhaMessage')

class AvatarStreamEntryRemovedMessage extends PiranhaMessage {
  constructor (client, highID, lowID) {
    super()
    this.id = 24418
    this.client = client
    this.version = 1
    this.highID = highID
    this.lowID = lowID
  }

  async encode () {
    this.writeLong(this.highID, this.lowID) // Stream entry id
  }
}

module.exports = AvatarStreamEntryRemovedMessage
