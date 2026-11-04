const AllianceHeaderEntry = require('./AllianceHeaderEntry')
const AllianceMemberEntry = require('./AllianceMemberEntry')

/**
 * Decoder for the AllianceFullEntry layout:
 * AllianceHeaderEntry, description STRING, member count INT, then member entries.
 */
class AllianceFullEntry {
  constructor () {
    this.header = null
    this.description = ''
    this.memberCount = 0
    this.members = []
  }

  decode (stream) {
    this.header = new AllianceHeaderEntry().decode(stream)
    this.description = stream.readString()
    this.memberCount = stream.readInt()

    // The native decoder treats negative counts as an absent member list.
    if (this.memberCount < 0) {
      this.members = null
      return this
    }

    this.members = []
    for (let i = 0; i < this.memberCount; i++) {
      this.members.push(new AllianceMemberEntry().decode(stream))
    }
    return this
  }
}

module.exports = AllianceFullEntry
