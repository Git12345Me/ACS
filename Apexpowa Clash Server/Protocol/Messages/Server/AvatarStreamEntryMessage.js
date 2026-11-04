const PiranhaMessage = require('../../PiranhaMessage')
const { writeAvatarStreamEntry } = require('../../../Core/AvatarStream')

// 24412: one new inbox entry, pushed to an online player.
class AvatarStreamEntryMessage extends PiranhaMessage {
  constructor (client, entry) {
    super()
    this.id = 24412
    this.client = client
    this.version = 1
    this.entry = entry
  }

  async encode () {
    writeAvatarStreamEntry(this, this.entry)
  }
}

module.exports = AvatarStreamEntryMessage
