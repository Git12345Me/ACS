const PiranhaMessage = require('../../PiranhaMessage')

class LeaveAllianceOkMessage extends PiranhaMessage {
  constructor (client, highID = null, lowID = null, reason = 1) {
    super()
    this.id = 24111
    this.client = client
    this.version = 1
    this.highID = highID
    this.lowID = lowID
    this.reason = reason
  }

  async encode () {
    this.writeInt(0x02) // ServerCommandType
    this.writeLong(
      this.highID == null ? this.client.player.clan.ClanHighID : this.highID,
      this.lowID == null ? this.client.player.clan.ClanLowID : this.lowID
    ) // HighID, LowID
    this.writeInt(this.reason) // Reason: 1 = Leave, 2 = Kick
    this.writeInt(-1)
  }
}

module.exports = LeaveAllianceOkMessage