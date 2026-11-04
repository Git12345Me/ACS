const PiranhaMessage = require('../../PiranhaMessage')
const KickAllianceMemberOkMessage = require('../../Messages/Server/KickAllianceMemberOkMessage')
const LeaveAllianceOkMessage = require('../../Messages/Server/LeaveAllianceOkMessage')
const PlayerManager = require('../../../Core/PlayerManager')
const ClanRoles = require('../../../Core/ClanRoles')
const { postClanEvent } = require('../../../Core/ClanEvents')

/**
 * 14307 - kick a clan member.
 *   Leader:    anyone except themselves
 *   Co-leader: Members and Elders
 *   Elder:     Members only, once every 20 minutes
 *   Member:    nothing
 * The kicked player gets a red "<name> has been kicked out of the clan by <you>" line in the clan chat.
 */
class KickAllianceMemberMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14307
    this.version = 1
  }

  async decode () {
    this.data = {}
    const memberId = this.readLong()
    this.data.MemberHighID = memberId[0]
    this.data.MemberLowID = memberId[1]
    try { this.data.Message = this.readString() } catch (e) { this.data.Message = '' }
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose
    const clanId = player && player.clan
    const log = msg => { if (typeof this.client.log === 'function') this.client.log(`[Alliance] kick refused: ${msg}`) }
    if (!player || !player.inClan || !clanId) return

    try {
      const clan = await db.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
      if (!clan || !Array.isArray(clan.members)) return

      const actor = ClanRoles.findMember(clan, player.highID, player.lowID)
      const target = ClanRoles.findMember(clan, this.data.MemberHighID, this.data.MemberLowID)
      if (!actor) return log('the sender is not in this clan')
      if (!target) return
      if (actor === target) return log('you cannot kick yourself')

      const verdict = ClanRoles.checkKick(actor.role, target.role)
      if (!verdict.ok) return log(verdict.reason)

      if (actor.role === ClanRoles.ROLE.ELDER) {
        const left = ClanRoles.cooldownLeft(actor, 'lastKickAt', ClanRoles.KICK_COOLDOWN_MS)
        if (left > 0) return log(`an Elder can kick once every 20 minutes (${Math.ceil(left / 60)} min left)`)
        actor.lastKickAt = Date.now() // saved together with the clan by kickMember
      }

      const kicked = Object.assign({}, target) // the entry is removed from the roster by kickMember
      await db.kickMember(clan, this.data.MemberHighID, this.data.MemberLowID)
      await new KickAllianceMemberOkMessage(this.client, this.data.MemberHighID, this.data.MemberLowID).send()

      // if the kicked player is online, they are out of the clan now (their session must not keep clan rights)
      for (const c of PlayerManager.getAll()) {
        const p = c.player
        if (!p || p.highID !== kicked.highID || p.lowID !== kicked.lowID) continue
        p.inClan = 0
        if (p.clan) { p.clan.ClanHighID = 0; p.clan.ClanLowID = 1; p.clan.ClanRole = 0 }
        try { await new LeaveAllianceOkMessage(c).send() } catch (e) { console.error(e) }
      }

      await postClanEvent(db, clan, { eventName: 'KICKED', target: kicked, actor: player })
    } catch (error) {
      console.error('Unable to kick alliance member:', error)
    }
  }
}

module.exports = KickAllianceMemberMessage
