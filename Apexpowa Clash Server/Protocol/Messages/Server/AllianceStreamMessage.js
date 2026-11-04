const PiranhaMessage = require('../../PiranhaMessage')
const ByteStream = require('../../../ByteStream')
const StreamAudit = require('../../../Core/StreamAudit')
const writeStreamEntry = require('./StreamEntryWriter')

class AllianceStreamMessage extends PiranhaMessage {
  constructor (client, clan = null) { /*fast*/
    super()
    this.id = 24311
    this.client = client
    this.clan = clan // a clan the caller already loaded: no second database read
    this.version = 1
    this.highID = this.client?.player?.clan?.ClanHighID ?? 0
    this.lowID = this.client?.player?.clan?.ClanLowID ?? 1
  }

  async encode () {
    const db = this.client.mongoose
    const clan = this.clan || await db.getClanByID(this.highID, this.lowID)
    const messages = Array.isArray(clan?.messages) ? clan.messages : []

    // Always the normal (reference) layout here, whatever a request test layout last set.
    writeStreamEntry.requestTextLayout = 0

    // Every entry is written on its own and checked against what the client's stream decode reads
    // (Core/StreamAudit.js) BEFORE it goes into the packet. The client's decode has no null check and reads
    // exactly what its decode says, so one entry that is wrong (unknown type, extra or missing bytes, an event
    // number without a text) shifts the rest of the list and the client closes the connection a moment later,
    // with no message anywhere. An entry that fails is left out and named in an [Error] line.
    const entries = []
    for (const message of messages) {
      let bytes
      try {
        const one = new ByteStream()
        writeStreamEntry(one, message)
        bytes = Buffer.from(one.buffer)
      } catch (e) {
        this.client.log(`[Error] stream entry #${message.id} (${message.type}) could not be written: ${e.message}`)
        continue
      }
      const verdict = StreamAudit.audit(bytes)
      if (!verdict.ok) {
        this.client.log(`[Error] stream entry #${message.id} (${message.type}) from ${message.senderHighID}-${message.senderLowID} left out of 24311: ${verdict.reason} | bytes: ${bytes.toString('hex')}`)
        continue
      }
      entries.push(bytes)
    }

    this.writeInt(entries.length) // StreamEntryCount
    for (const bytes of entries) for (const b of bytes) this.writeByte(b)
    if (entries.length !== messages.length) this.client.log(`[Error] 24311: ${messages.length - entries.length} of ${messages.length} stream entries were left out (see the lines above)`)
  }
}

module.exports = AllianceStreamMessage
