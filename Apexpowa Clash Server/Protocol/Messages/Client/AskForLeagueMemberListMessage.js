const PiranhaMessage = require('../../PiranhaMessage')
const LeaguePlayersMessage = require('../Server/LeaguePlayersMessage')

class AskForLeagueMemberListMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14503
    this.version = 1
  }

  // ByteStream in older server deployments does not expose readByte().
  readProtocolByte () {
    this.bitOffset = 0
    if (this.offset >= this.buffer.length) {
      throw new RangeError('Cannot read a BYTE past the end of the message.')
    }
    return this.buffer[this.offset++]
  }

  async decode () {
    this.data = {}
    // AskForLeagueMemberList is BYTE, INT, INT. A short or different body must not stop the answer: the list
    // is the same whatever range is asked for, so a failed read is ignored and process() still sends it.
    try {
      this.data.LeagueType = this.readProtocolByte()
      this.data.StartIndex = this.readInt()
      this.data.EndIndex = this.readInt()
    } catch (e) {
      if (this.client && this.client.log) this.client.log(`[League] 14503 body not read (${e.message}); sending the list anyway`)
    }
  }

  async process () {
    if (this.client && this.client.log) this.client.log(`[League] 14503 asked: league=${this.data.LeagueType} range=${this.data.StartIndex}-${this.data.EndIndex}`)
    if (!this.client || !this.client.player) return
    try {
      await new LeaguePlayersMessage(this.client).send()
    } catch (e) {
      console.error('[League] could not send the league list:', e.message)
    }
  }
}

module.exports = AskForLeagueMemberListMessage