const PiranhaMessage = require('../../PiranhaMessage')

/** 24338 - clan war log. Replaces the empty stub. wars.md section 3 (HistoryEntry order). */
class AllianceWarHistoryMessage extends PiranhaMessage {
  constructor (client, entries = [], allianceId = [0, 0]) {
    super()
    this.id = 24338
    this.client = client
    this.version = 1
    this.entries = entries
    this.allianceId = allianceId
  }

  encode () {
    this.writeInt(this.entries.length)
    for (const r of this.entries) {
      this.writeLong(r.clanId[0], r.clanId[1])
      this.writeString(r.clanName)
      this.writeInt(r.clanBadge)
      this.writeInt(r.clanLevel)
      this.writeLong(r.enemyId[0], r.enemyId[1])
      this.writeString(r.enemyName)
      this.writeInt(r.enemyBadge)
      this.writeInt(r.enemyLevel)
      this.writeInt(r.clanStars)
      this.writeInt(r.enemyStars)
      this.writeInt(r.clanDestruction)
      this.writeInt(r.enemyDestruction)
      this.writeInt(0) // +0x58
      this.writeInt(0) // +0x5c
      this.writeInt(0) // +0x60
      this.writeInt(r.expEarned)
      this.writeLong(0, r.warId) // id asked back with 14336
      this.writeInt(r.size) // team size (divisor for destruction %)
      this.writeInt(r.result) // 1 win, 0 lose, anything else draw
      this.writeBoolean(false) // no-browse
      this.writeInt(Math.max(0, Math.floor((Date.now() - r.ended) / 1000))) // age
      this.writeLong(0, 0) // +0x44
      this.writeInt(0) // +0x78
    }
    this.writeLong(this.allianceId[0], this.allianceId[1])
    this.writeBoolean(false) // true (as in the C# reference) made the game close the connection right after this packet
  }
}

module.exports = AllianceWarHistoryMessage
