const PiranhaMessage = require('../../PiranhaMessage')
const { writeEntry } = require('../../../Core/WarWriters')

/** 24329 - AllianceWarEntry: one clan's war entry (header, members, exp block). Answer to 14332 AskForAllianceWarData. */
class AllianceWarEntryMessage extends PiranhaMessage {
  constructor (client, side, exp) {
    super()
    this.id = 24329
    this.client = client
    this.version = 1
    this.side = side // { highID, lowID, name, badge, level, members: [] }
    this.exp = exp
  }

  encode () {
    writeEntry(this, this.side, this.exp)
  }
}

module.exports = AllianceWarEntryMessage
