const PiranhaMessage = require('../../PiranhaMessage')
const writeMemberEntry = require('./AllianceMemberEntryWriter')

/** 24308 - a member joined / changed inside the clan. `member` = clan member entry. */
class AllianceMemberMessage extends PiranhaMessage {
  constructor (client, member) {
    super()
    this.id = 24308
    this.client = client
    this.version = 1
    this.member = member
  }

  async encode () {
    writeMemberEntry(this, this.member)
  }
}

module.exports = AllianceMemberMessage
