const PiranhaMessage = require('../../PiranhaMessage')
const KickAllianceMemberOkMessage = require('../Server/KickAllianceMemberOkMessage')
const LeaveAllianceOkMessage = require('../Server/LeaveAllianceOkMessage')
const AllianceMemberRemovedMessage = require('../Server/AllianceMemberRemovedMessage')
const ServerErrorMessage = require('../Server/ServerErrorMessage')
const ClanPermissions = require('../../../Core/ClanPermissions')
const ClanEvents = require('../../../Core/ClanEvents')
const PlayerManager = require('../../../Core/PlayerManager')

const ELDER_KICK_COOLDOWN_MS = 20 * 60 * 1000

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

    if (!player || !player.inClan || !clanId || !db) return

    try {
      const clan = await db.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
      if (!clan || !Array.isArray(clan.members)) return

      const actor = clan.members.find(member =>
        member.highID === player.highID && member.lowID === player.lowID
      )
      const target = clan.members.find(m =>
        m.highID === this.data.MemberHighID && m.lowID === this.data.MemberLowID)
      if (!actor || !target) return

      const isSelf = target.highID === player.highID && target.lowID === player.lowID
      if (!ClanPermissions.canKick(Number(actor.role) || 1, Number(target.role) || 1, isSelf)) return

      const now = Date.now()
      if (Number(actor.role) === ClanPermissions.ROLE.ELDER) {
        const elapsed = now - (Number(actor.lastKickAt) || 0)
        if (elapsed < ELDER_KICK_COOLDOWN_MS) {
          const minutes = Math.ceil((ELDER_KICK_COOLDOWN_MS - elapsed) / 60000)
          await new ServerErrorMessage(this.client, `Elders can kick once every 20 minutes. Try again in ${minutes} minute(s).`).send()
          return
        }
        actor.lastKickAt = now
      }

      try { const WarManager = require('../../../Core/WarManager'); WarManager.attach(db); WarManager.onLeftClan(kicked, `${clanId.ClanHighID}-${clanId.ClanLowID}`) } catch (e) { console.error('[War] kick cooldown:', e.message) } // kicked mid-war = war cooldown
      await db.kickMember(clan, this.data.MemberHighID, this.data.MemberLowID)
      const kickedClients = Array.from(PlayerManager.getAll()).filter(c =>
        c.player && c.player.highID === target.highID && c.player.lowID === target.lowID
      )

      await ClanEvents.publish(clan, 'KICKED', target, player, [this.client, ...kickedClients])

      // Remove the kicked avatar from each still-connected clan roster.
      for (const c of PlayerManager.getAll()) {
        const p = c.player
        if (!p || !p.inClan || !p.clan ||
          p.clan.ClanHighID !== clan.highID || p.clan.ClanLowID !== clan.lowID ||
          c === this.client || kickedClients.includes(c) || c.destroyed || c.writable === false) continue
        try {
          await new AllianceMemberRemovedMessage(c, target.highID, target.lowID).send()
        } catch (error) {
          console.error('[Clan] Could not update roster after kick:', error.message)
        }
      }

      for (const c of kickedClients) {
        try {
          await new LeaveAllianceOkMessage(c, clan.highID, clan.lowID, 2).send()
        } catch (error) {
          console.error('[Clan] Could not notify kicked player:', error.message)
        }
        c.player.inClan = 0
        c.player.clan = { ClanHighID: 0, ClanLowID: 1, ClanRole: 0 }
      }

      await new KickAllianceMemberOkMessage(
        this.client, this.data.MemberHighID, this.data.MemberLowID).send()
    } catch (error) {
      console.error('Unable to kick alliance member:', error)
    }
  }
}

module.exports = KickAllianceMemberMessage
