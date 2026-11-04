const LeagueUtils = require('../../../Utilities/LeagueUtils')
const PiranhaMessage = require('../../PiranhaMessage')
const PlayerManager = require('../../../Core/PlayerManager')
const AllianceStreamEntryMessage = require('../Server/AllianceStreamEntryMessage')
const writeStreamEntry = require('../Server/StreamEntryWriter')

// Roles in this protocol: 1 member, 2 leader, 3 elder, 4 co-leader.
const MEMBER = 49
const LEADER = 1
const ELDER = 3
const CO_LEADER = 4

// Every clan has exactly ONE leader and at most MAX_CO_LEADERS co-leaders.
const MAX_CO_LEADERS = 4

// Rank for promote / demote: member < elder < co-leader < leader.
const RANK = { 1: 0, 3: 1, 4: 2, 2: 3 }

const roleOf = member => (member && member.role >= 1 && member.role <= 4 ? member.role : MEMBER)

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

  // Repairs a clan that already breaks the limits (several leaders or too many co-leaders, for
  // example from earlier tests): the first leader in the list stays leader, extra leaders become
  // co-leaders, and co-leaders beyond the limit become elders. Returns the members that changed.
  static normalizeRoles (clan) {
    const changes = []
    const members = clan.members || []
    const leaders = members.filter(m => roleOf(m) === LEADER)
    leaders.slice(1).forEach(m => changes.push({ member: m, oldRole: LEADER, newRole: CO_LEADER }))
    leaders.slice(1).forEach(m => { m.role = CO_LEADER })

    const coLeaders = members.filter(m => roleOf(m) === CO_LEADER)
    coLeaders.slice(MAX_CO_LEADERS).forEach(m => changes.push({ member: m, oldRole: CO_LEADER, newRole: ELDER }))
    coLeaders.slice(MAX_CO_LEADERS).forEach(m => { m.role = ELDER })
    return changes
  }

  async process () {
    const player = this.client && this.client.player
    const db = this.client && this.client.mongoose
    const clanId = player && player.clan

    // Only the leader (2) and co-leaders (4) may change a member role.
    const myRole = (clanId && clanId.ClanRole) || 0
    if (!player || !player.inClan || !clanId || (myRole !== LEADER && myRole !== CO_LEADER)) {
      return
    }

    if (!db || typeof db.getClanByID !== 'function' ||
      typeof db.promoteMember !== 'function') {
      return
    }

    const newRole = this.data.Role
    if (newRole < 1 || newRole > 4) return

    try {
      const clan = await db.getClanByID(
        clanId.ClanHighID,
        clanId.ClanLowID
      )
      if (!clan || !Array.isArray(clan.members)) return

      const target = clan.members.find(member =>
        member.highID === this.data.MemberHighID &&
        member.lowID === this.data.MemberLowID
      )
      if (!target) return

      // Fix a clan that already has several leaders or too many co-leaders first.
      for (const fix of ChangeAllianceMemberRoleMessage.normalizeRoles(clan)) {
        await db.promoteMember(clan, fix.member.highID, fix.member.lowID, fix.newRole)
        this.syncSessionRole(fix.member, fix.newRole)
      }

      const oldRole = roleOf(target)
      if (oldRole === newRole) return

      const me = clan.members.find(m => m.highID === player.highID && m.lowID === player.lowID)
      const actingRole = roleOf(me)

      // The leader can only be replaced by the leader handing the clan over to someone else.
      if (oldRole === LEADER) return
      // Only the leader can make a new leader.
      if (newRole === LEADER && actingRole !== LEADER) return
      // A co-leader may only move members and elders between member and elder.
      if (actingRole === CO_LEADER && (
        (newRole !== MEMBER && newRole !== ELDER) ||
        (oldRole !== MEMBER && oldRole !== ELDER)
      )) return
      // At most MAX_CO_LEADERS co-leaders.
      if (newRole === CO_LEADER &&
        clan.members.filter(m => roleOf(m) === CO_LEADER).length >= MAX_CO_LEADERS) return

      const changes = []
      if (newRole === LEADER) {
        // Handing over: the old leader becomes a co-leader, so there is still exactly one leader.
        // If the new leader was a co-leader, that seat frees up; if all seats are taken otherwise,
        // the old leader becomes an elder instead of breaking the co-leader limit.
        const seatsTaken = clan.members.filter(m => roleOf(m) === CO_LEADER).length - (oldRole === CO_LEADER ? 1 : 0)
        changes.push({ member: me, oldRole: LEADER, newRole: seatsTaken < MAX_CO_LEADERS ? CO_LEADER : ELDER })
      }
      changes.push({ member: target, oldRole, newRole })

      for (const change of changes) {
        await db.promoteMember(clan, change.member.highID, change.member.lowID, change.newRole)
        this.syncSessionRole(change.member, change.newRole)
      }

      // Clan chat events "<member> has been promoted / demoted": native event entries, so the game
      // draws them itself in its own colours and language. Saved in the stream for later too.
      if (typeof writeStreamEntry.refreshEventTypes === 'function') writeStreamEntry.refreshEventTypes()
      const EVENT = writeStreamEntry.EVENT_TYPE
      if (!Array.isArray(clan.messages)) clan.messages = []
      const entries = []
      for (const change of changes) {
        const promoted = (RANK[change.newRole] || 0) > (RANK[change.oldRole] || 0)
        const entry = {
          id: clan.messages.reduce((max, m) => Math.max(max, (m && m.id) || 0), 0) + 1,
          type: 'event',
          eventType: promoted ? EVENT.PROMOTED : EVENT.DEMOTED, // null if the game's number is unknown
          eventName: promoted ? 'PROMOTED' : 'DEMOTED',
          newRole: change.newRole,
          // the entry is about the member whose role changed ...
          senderHighID: change.member.highID,
          senderLowID: change.member.lowID,
          senderName: change.member.name || '',
          senderRole: change.newRole,
          senderLevel: change.member.level || change.member.expLevel || 1,
          senderLeague: LeagueUtils.of(change.member),
          // ... and was done by this leader / co-leader
          actorHighID: player.highID,
          actorLowID: player.lowID,
          actorName: player.name,
          timestamp: new Date()
        }
        clan.messages.push(entry)
        entries.push(entry)
      }
      clan.markModified('messages')
      await clan.save()

      // Show it right away to every clan member that is online.
      for (const c of PlayerManager.getAll()) {
        const p = c.player
        if (!p || !p.inClan || !p.clan) continue
        if (p.clan.ClanHighID !== clanId.ClanHighID || p.clan.ClanLowID !== clanId.ClanLowID) continue
        if (c.destroyed || c.writable === false) continue
        try {
          for (const entry of entries) await new AllianceStreamEntryMessage(c, entry).send()
        } catch (e) {
          console.error(e)
        }
      }
    } catch (error) {
      console.error('Unable to change alliance member role:', error)
    }
  }

  // The member may be online: keep the role of their session in step with the database.
  syncSessionRole (member, role) {
    for (const c of PlayerManager.getAll()) {
      const p = c.player
      if (p && p.highID === member.highID && p.lowID === member.lowID && p.clan) p.clan.ClanRole = role
    }
  }
}

module.exports = ChangeAllianceMemberRoleMessage
