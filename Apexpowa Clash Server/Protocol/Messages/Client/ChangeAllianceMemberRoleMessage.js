const PiranhaMessage = require('../../PiranhaMessage')
const PlayerManager = require('../../../Core/PlayerManager')
const ClanRoles = require('../../../Core/ClanRoles')
const { postClanEvent } = require('../../../Core/ClanEvents')

const { ROLE, RANK } = ClanRoles

/**
 * 14306 - promote / demote a clan member. Roles: 1 member, 2 leader, 3 elder, 4 co-leader.
 *   Leader:    can set any role on anyone else; making a Co-leader the Leader hands the clan over and the old Leader
 *              becomes Co-leader
 *   Co-leader: can turn Members into Elders and Elders into Members, and promote new Co-leaders; cannot touch the
 *              Leader or other Co-leaders
 *   Others:    nothing
 * The rules are in Core/ClanRoles.js; the acting player's role is read from the clan roster, not from the session.
 */
class ChangeAllianceMemberRoleMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14306
    this.version = 1
  }

  async decode () {
    this.data = {}
    const memberId = this.readLong()
    this.data.MemberHighID = memberId[0]
    this.data.MemberLowID = memberId[1]
    this.data.Role = this.readInt()
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose
    const clanId = player && player.clan
    const log = msg => { if (typeof this.client.log === 'function') this.client.log(`[Alliance] role change refused: ${msg}`) }
    if (!player || !player.inClan || !clanId) return

    try {
      const clan = await db.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
      if (!clan || !Array.isArray(clan.members)) return

      const actor = ClanRoles.findMember(clan, player.highID, player.lowID)
      const target = ClanRoles.findMember(clan, this.data.MemberHighID, this.data.MemberLowID)
      if (!actor) return log('the sender is not in this clan')
      if (!target) return
      if (actor === target) return log('you cannot change your own role')

      const oldRole = target.role
      const newRole = this.data.Role
      if (oldRole === newRole) return

      const verdict = ClanRoles.checkRoleChange(actor.role, oldRole, newRole)
      if (!verdict.ok) return log(verdict.reason)

      await db.promoteMember(clan, target.highID, target.lowID, newRole)
      if (verdict.handover) await db.promoteMember(clan, actor.highID, actor.lowID, ROLE.COLEADER)

      // online members: keep the cached role of their session in step with the database
      const syncSession = (member, role) => {
        for (const c of PlayerManager.getAll()) {
          const p = c.player
          if (p && p.highID === member.highID && p.lowID === member.lowID && p.clan) p.clan.ClanRole = role
        }
      }
      syncSession(target, newRole)
      if (verdict.handover) {
        syncSession(actor, ROLE.COLEADER)
        player.clan.ClanRole = ROLE.COLEADER
      }

      const promoted = (RANK[newRole] || 0) > (RANK[oldRole] || 0)
      await postClanEvent(db, clan, { eventName: promoted ? 'PROMOTED' : 'DEMOTED', target, actor: player, newRole })
    } catch (error) {
      console.error('Unable to change alliance member role:', error)
    }
  }
}

module.exports = ChangeAllianceMemberRoleMessage
