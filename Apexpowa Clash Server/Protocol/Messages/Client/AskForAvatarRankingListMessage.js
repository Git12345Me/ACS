const PiranhaMessage = require('../../PiranhaMessage')
const AvatarRankingListMessage = require('../Server/AvatarRankingListMessage')

// Client message 14403 (global player ranking). This file used to hold a copy of the SERVER message
// (id 24403), so 14403 had no handler ("UnhandledPacket (14403)"). The 9-byte payload is not needed.
class AskForAvatarRankingListMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14403
    this.version = 1
  }

  async decode () {}

  async process () {
    await new AvatarRankingListMessage(this.client).send()
  }
}

module.exports = AskForAvatarRankingListMessage
