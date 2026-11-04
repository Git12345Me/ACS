const PiranhaMessage = require('../../PiranhaMessage')

class AllianceLocalRankingListMessage extends PiranhaMessage {
  constructor (client, clans = []) {
    super()
    this.id = 24402
    this.client = client
    this.version = 1
    this.clans = clans
  }

  async encode () {
    this.writeInt(this.clans.length)
    for (let i = 0; i < this.clans.length; i++) {
      const clan = this.clans[i]
      this.writeLong(clan.highID, clan.lowID)
      this.writeString(clan.name)
      this.writeInt(i + 1)
      this.writeInt(clan.trophies || 0)
      this.writeInt(200)
      this.writeInt(clan.badge)
      this.writeInt(clan.members?.length || 0)
    }
  }
}

module.exports = AllianceLocalRankingListMessage
