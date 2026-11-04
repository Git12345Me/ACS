const PiranhaMessage = require('../../PiranhaMessage')

class AllianceInvitationSentOkMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24322
    this.client = client
    this.version = 1
  }

  async encode () {
  }
}

module.exports = AllianceInvitationSentOkMessage
