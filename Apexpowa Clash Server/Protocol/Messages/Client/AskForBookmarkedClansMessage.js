const PiranhaMessage = require('../../PiranhaMessage')
const BookmarkedClansMessage = require('../Server/BookmarkedClansMessage')

class AskForBookmarkedClansMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14341
    this.version = 1
  }

  async decode () {}

  async process () {
    await new BookmarkedClansMessage(this.client).send()
  }
}

module.exports = AskForBookmarkedClansMessage
