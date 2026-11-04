const PiranhaMessage = require('../../PiranhaMessage')

class AllianceStreamEntryRemovedMessage extends PiranhaMessage {
  constructor (client, messageID) {
    super()
    this.id = 24318
    this.client = client
    this.version = 1
    this.messageID = messageID
  }

  async encode () {
    // Same encoding as the entry id in StreamEntryWriter: id in the first int, 0 in the second
    this.writeLong(this.messageID, 0) // Stream entry id
  }
}

module.exports = AllianceStreamEntryRemovedMessage
