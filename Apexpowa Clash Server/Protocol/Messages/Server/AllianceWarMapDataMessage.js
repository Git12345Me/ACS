const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 24335 - clan war state, as this client decodes it (libg.so, decode @0x116A00, encode @0x116B20):
 *
 *   INT   state          (1 = searching for opponents; 4 = preparation, 5 = battle, 6 = ended)
 *   INT   timeLeft       (seconds)
 *   <clan entry>         your clan:
 *           LONG   id
 *           STRING name
 *           INT    badge (data reference)
 *           INT    memberCount, then that many 200-byte war members (not simulated: 0)
 *   BOOL  hasOpponent    [<clan entry> of the opponent]
 *   BOOL  hasWarId       [LONG warId]
 *   INT   commandCount   (-1 = none), then that many commands
 *
 * The two BOOLs are written back to back, so ByteStream packs them into ONE byte, which is
 * what the client reads (it unpacks two bools from one byte).
 *
 * The old version wrote an "AllianceLevel" INT where the client reads the MEMBER COUNT (so it
 * announced one member and the client read past the end of the packet) and never wrote the
 * opponent / war id / command fields.
 *
 * Wars themselves are not simulated: this reports "searching for opponents" with no members.
 */
class AllianceWarMapDataMessage extends PiranhaMessage {
  constructor (client, state = 1, timeLeft = 3600) {
    super()
    this.id = 24335
    this.client = client
    this.version = 1
    this.state = state
    this.timeLeft = timeLeft
  }

  async encode () {
    const player = this.client.player
    if (!player || !player.inClan || !player.clan) {
      throw new Error('the player is not in a clan, so there is no war to describe')
    }

    const { ClanHighID, ClanLowID } = player.clan
    const clan = await this.client.mongoose.getClanByID(ClanHighID, ClanLowID)
    if (!clan) throw new Error(`clan ${ClanHighID}-${ClanLowID} was not found in the database`)

    this.writeInt(this.state) // State
    this.writeInt(this.timeLeft) // TimeLeft

    // Clan entry: your clan
    this.writeLong(clan.highID, clan.lowID) // Id
    this.writeString(clan.name || '') // Name
    this.writeInt(clan.badge || 0) // Badge
    this.writeInt(0) // MemberCount: war members are not simulated

    this.writeBoolean(false) // no opponent clan yet
    this.writeBoolean(false) // no war id
    this.writeInt(-1) // no commands
  }
}

module.exports = AllianceWarMapDataMessage
