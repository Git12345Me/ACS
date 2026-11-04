const PlayerManager = require('../../../Core/PlayerManager')
const AvatarStreamEntryMessage = require('../../Messages/Server/AvatarStreamEntryMessage')
const { CLAN_MAIL, MAX_TEXT, addToInbox } = require('../../../Core/AvatarStream')
const Globals = require('../../../Core/Globals')

const lastMail = new Map() // clan -> time of the last clan mail (ms); CLAN_MAIL_COOLDOWN from globals.csv

// Command 537 "send clan mail" (the button in the clan screen). Wire layout: STRING text, then the tick; the string
// comes BEFORE the tick. The mail goes to the inbox of every member of the clan. The game itself limits how often
// it can be sent and offers the button only to leaders and co-leaders (no role check on the server, as in the C# version).
// Every step logs with the "[Logic]" prefix (always shown in the console), also when it stops early.
class LogicSendAllianceMailCommand {
  async decode (self) {
    this.data = {}
    this.data.Message = self.readString() || ''
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const db = client.mongoose
    const text = String(this.data.Message).trim().slice(0, Globals.number('MAX_ALLIANCE_MAIL_LENGTH', MAX_TEXT))
    const clanId = player && player.clan

    if (!player || !player.inClan || !clanId || !text) {
      return client.log(`[Logic] mail: stopped, player=${!!player} inClan=${player && player.inClan} clan=${JSON.stringify(clanId)} text="${text}"`)
    }
    // Like the original server there is no role check here: the game only offers the button to leaders and co-leaders.

    const clan = await db.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
    if (!clan || !Array.isArray(clan.members)) {
      return client.log(`[Logic] mail: stopped, clan ${clanId.ClanHighID}-${clanId.ClanLowID} not found or has no member list (clan=${!!clan})`)
    }
    // CLAN_MAIL_COOLDOWN (seconds, globals.csv): one clan mail per clan in that time
    const cooldown = Globals.number('CLAN_MAIL_COOLDOWN', 0) * 1000
    const key = `${clan.highID}-${clan.lowID}`
    const wait = (lastMail.get(key) || 0) + cooldown - Date.now()
    if (cooldown > 0 && wait > 0) {
      return client.log(`[Logic] mail: stopped, "${clan.name}" sent a clan mail ${Math.round((cooldown - wait) / 60000)} min ago (CLAN_MAIL_COOLDOWN ${cooldown / 1000}s), ${Math.ceil(wait / 60000)} min left`)
    }
    lastMail.set(key, Date.now())
    client.log(`[Logic] mail: sending to the ${clan.members.length} member(s) of "${clan.name}"`)

    const mail = {
      type: CLAN_MAIL,
      senderHighID: player.highID,
      senderLowID: player.lowID,
      senderName: player.name,
      senderLevel: player.level || 1,
      senderLeague: player.league || 0,
      clanHighID: clan.highID,
      clanLowID: clan.lowID,
      clanName: clan.name,
      clanBadge: clan.badge,
      message: text,
      timestamp: new Date().toISOString()
    }

    let delivered = 0
    for (const member of clan.members) {
      // an online member's live record, so a later save does not overwrite the mail
      let connection = null
      for (const c of PlayerManager.getAll()) {
        const p = c.player
        if (p && p.highID === member.highID && p.lowID === member.lowID) { connection = c; break }
      }
      let target = connection ? connection.player : null
      if (!target) {
        target = await new Promise(resolve => db.getSpecificPlayer(member.highID, member.lowID, (err, p) => resolve(err ? null : p)))
      }
      if (!target) { client.log(`[Logic] mail: member ${member.highID}-${member.lowID} not found`); continue }

      const entry = addToInbox(target, mail)
      delivered++
      client.log(`[Logic] mail: saved as mail #${entry.id} for ${target.highID}-${target.lowID} (${connection ? 'online' : 'offline'})`)
      if (connection) {
        try { await new AvatarStreamEntryMessage(connection, entry).send() } catch (e) { client.log(`[Logic] mail: could not push to ${member.name}: ${e.message}`) }
      }
    }
    client.log(`[Logic] mail: ${player.name} sent clan mail to ${delivered} member(s): "${text}"`)
  }
}

module.exports = LogicSendAllianceMailCommand
