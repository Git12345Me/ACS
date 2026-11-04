const PiranhaMessage = require('../../PiranhaMessage')
const { writeMember } = require('../../../Core/WarWriters')

/** 24323 - one war member changed (live attacker, called target...). The client replaces it in the clan with the same id. */
class WarMemberMessage extends PiranhaMessage {
  constructor (client, clan, member) {
    super()
    this.id = 24323
    this.client = client
    this.version = 1
    this.clan = clan
    this.member = member
  }

  encode () {
    writeMember(this, this.clan, this.member)
  }
}

module.exports = WarMemberMessage
