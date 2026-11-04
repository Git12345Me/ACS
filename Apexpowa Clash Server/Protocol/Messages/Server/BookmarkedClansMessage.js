const PiranhaMessage = require('../../PiranhaMessage')

class BookmarkedClansMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24341
    this.client = client
    this.version = 1
  }

  async encode () {
    this.writeInt(0) // No bookmarked clans stored yet
  }
}

module.exports = BookmarkedClansMessage
