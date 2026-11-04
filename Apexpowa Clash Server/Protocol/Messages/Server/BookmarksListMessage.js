const PiranhaMessage = require('../../PiranhaMessage')

class BookmarksListMessage extends PiranhaMessage {
  constructor (client, clanIDs = []) {
    super()
    this.id = 24340
    this.client = client
    this.version = 1
    this.clanIDs = clanIDs // [{ highID, lowID }]
  }

  async encode () {
    this.writeInt(this.clanIDs.length)
    for (const id of this.clanIDs) {
      this.writeLong(id.highID, id.lowID)
    }
  }
}

module.exports = BookmarksListMessage
