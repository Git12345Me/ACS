const PiranhaMessage = require('../../PiranhaMessage')
const AvailableServerCommandMessage = require('../Server/AvailableServerCommandMessage')
const OutOfSyncMessage = require('../Server/OutOfSyncMessage')
const ServerErrorMessage = require('../Server/ServerErrorMessage')
const ClanEvents = require('../../../Core/ClanEvents')

class JoinAllianceUsingInvitationMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14323
    this.version = 1
  }

  async decode () {
    this.data = {}
    const invitationId = this.readLong()
    this.data.InvitationHighID = invitationId[0]
    this.data.InvitationLowID = invitationId[1]
    const clanId = this.readLong()
    this.data.ClanHighID = clanId[0]
    this.data.ClanLowID = clanId[1]
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose

    if (player.inClan) {
      await new OutOfSyncMessage(this.client).send()
      return
    }

    try {
      const clan = await db.getClanByID(this.data.ClanHighID, this.data.ClanLowID)
      if (!clan) {
        await new ServerErrorMessage(this.client, 'Clan not found.').send()
        return
      }
      const joinedClan = await db.joinClan(player, clan)
      const joinedMember = (joinedClan && joinedClan.members || clan.members || []).find(member =>
        member.highID === player.highID && member.lowID === player.lowID
      ) || player
      await ClanEvents.publish(joinedClan || clan, 'JOINED', joinedMember)
      await new AvailableServerCommandMessage(this.client, 1).send()
    } catch (e) {
      await new ServerErrorMessage(this.client, e.message || 'Failed to join clan.').send()
      console.error(e)
    }
  }
}

module.exports = JoinAllianceUsingInvitationMessage
