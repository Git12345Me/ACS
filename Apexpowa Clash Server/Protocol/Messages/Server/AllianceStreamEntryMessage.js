const PiranhaMessage = require('../../PiranhaMessage')
const writeStreamEntry = require('./StreamEntryWriter')

class AllianceStreamEntryMessage extends PiranhaMessage {
  constructor (client, message) {
    super()
    this.id = 24312
    this.client = client
    this.version = 1
    this.message = message // stream entry, see StreamEntryWriter
  }

  async encode () {
    writeStreamEntry(this, this.message)
  }
}

module.exports = AllianceStreamEntryMessage
