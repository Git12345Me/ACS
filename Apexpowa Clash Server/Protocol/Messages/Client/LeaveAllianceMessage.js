const PiranhaMessage = require('../../PiranhaMessage')
const LeaveAllianceOkMessage = require('../Server/LeaveAllianceOkMessage')
const OutOfSyncMessage = require('../Server/OutOfSyncMessage')
const PlayerManager = require('../../../Core/PlayerManager')
const ClanRoles = require('../../../Core/ClanRoles')
const { postClanEvent } = require('../../../Core/ClanEvents')

/**
 * 14308 - leave the clan. The clan chat gets "<name> has left the clan" (red). If the Leader leaves, the leadership goes
 * to the Co-leader who has been in the clan longest (else an Elder, else a Member): see leaveClan in the database layer.
 */
class LeaveAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14308
    this.version = 1
  }

  async decode () {}

  async process () {
    const player = this.client.player
    const db = this.client.mongoose

    if (!player.inClan) {
      await new OutOfSyncMessage(this.client).send() // Not in a clan
      return
    }

    try {
      const high = player.clan.ClanHighID
      const low = player.clan.ClanLowID
      const who = { highID: player.highID, lowID: player.lowID, name: player.name, level: player.level, league: player.league }

      try { const WarManager = require('../../../Core/WarManager'); WarManager.attach(db); WarManager.onLeftClan(player, `${high}-${low}`) } catch (e) { console.error('[War] leave cooldown:', e.message) } // leaving a war clan mid-war = war cooldown
      await new LeaveAllianceOkMessage(this.client).send()
      await db.leaveClan(player)

      // the clan as it is now (it is gone when the last member left)
      const clan = await db.getClanByID(high, low)
      if (!clan) return

      // a new Leader: tell their session, if they are online
      const leader = (clan.members || []).find(m => m.role === ClanRoles.ROLE.LEADER)
      if (leader) {
        for (const c of PlayerManager.getAll()) {
          const p = c.player
          if (p && p.highID === leader.highID && p.lowID === leader.lowID && p.clan) p.clan.ClanRole = ClanRoles.ROLE.LEADER
        }
      }

      await postClanEvent(db, clan, { eventName: 'LEFT', target: who })
    } catch (e) {
      console.error(e)
      await new OutOfSyncMessage(this.client).send()
    }
  }
}

module.exports = LeaveAllianceMessage
