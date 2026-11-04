const PiranhaMessage = require('../../PiranhaMessage')
const AllianceInvitationSentOkMessage = require('../Server/AllianceInvitationSentOkMessage')
const ServerErrorMessage = require('../Server/ServerErrorMessage')
const ClanRoles = require('../../../Core/ClanRoles')

/** 14322 - invite a player to the clan. Elders, Co-leaders and the Leader may invite; Members may not. */
class SendAllianceInvitationMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14322
    this.version = 1
  }

  async decode () {
    this.data = {}
    const userId = this.readLong()
    this.data.UserHighID = userId[0]
    this.data.UserLowID = userId[1]
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose
    if (!player || !player.inClan || !player.clan) {
      await new ServerErrorMessage(this.client, 'You are not in a clan.').send()
      return
    }

    const clan = await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
    if (!ClanRoles.can(ClanRoles.roleOf(clan, player), 'invite')) {
      await new ServerErrorMessage(this.client, 'Only Elders, Co-leaders and the Leader can invite players.').send()
      return
    }
    await new AllianceInvitationSentOkMessage(this.client).send()
  }
}

module.exports = SendAllianceInvitationMessage
