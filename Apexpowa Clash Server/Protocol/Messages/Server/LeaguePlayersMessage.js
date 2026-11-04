const PiranhaMessage = require('../../PiranhaMessage')

// 24503: the players of the viewer's league, best first.
//   INT league id
//   INT count, then count entries
// One entry, as this client reads it (decoded from libg.so, the league player decode @0x121404):
//   LONG   avatar id
//   STRING name
//   INT x8 rank, trophies, previous rank, level, attacks won, attacks lost, defenses won, defenses lost
//   LONG   home id
//   LONG   (not identified, 0)
//   BOOL   hasClan  ->  LONG clan id, STRING clan name, INT clan badge
//   LONG   (not identified, 0)          <- ALWAYS present, after the optional clan block
// The last LONG was missing: the client read 8 bytes of the next entry (or past the end of the message for the
// last one), so every entry after the first was misread and the game closed.
const LEAGUE_ID = 9000
const MAX_PLAYERS = 50

class LeaguePlayersMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24503
    this.client = client
    this.version = 1
  }

  async encode () {
    const db = this.client.mongoose
    const me = this.client.player
    let players = []
    try { players = await db.getTopPlayers(200) } catch (e) { players = [] }

    // Same league as the viewer (league 0 = unranked), best trophies first.
    players = players.filter(p => (p.league || 0) === (me.league || 0))
    players.sort((a, b) => (b.trophies || 0) - (a.trophies || 0))
    players = players.slice(0, MAX_PLAYERS)
    if (!players.some(p => p.highID === me.highID && p.lowID === me.lowID)) players.push(me)

    const clanCache = {}
    this.writeInt(LEAGUE_ID)
    this.writeInt(players.length)

    for (let i = 0; i < players.length; i++) {
      const p = players[i]
      this.writeLong(p.highID, p.lowID) // avatar id
      this.writeString(p.name || '')
      this.writeInt(i + 1) // rank
      this.writeInt(p.trophies || 0)
      this.writeInt(i + 1) // previous rank
      this.writeInt(p.level || 1)
      this.writeInt(p.attackWinCount || 0)
      this.writeInt(p.attackLoseCount || 0)
      this.writeInt(p.defendWinCount || 0)
      this.writeInt(p.defendLoseCount || 0)
      this.writeLong(p.highID, p.lowID) // home id
      this.writeLong(0, 0)

      let clan = null
      if (p.inClan && p.clan) {
        const k = `${p.clan.ClanHighID}:${p.clan.ClanLowID}`
        if (clanCache[k] === undefined) {
          try { clanCache[k] = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID) || null } catch (e) { clanCache[k] = null }
        }
        clan = clanCache[k]
      }
      this.writeBoolean(!!clan)
      if (clan) {
        this.writeLong(clan.highID, clan.lowID)
        this.writeString(clan.name || '')
        this.writeInt(clan.badge || 0)
      }
      this.writeLong(0, 0)
    }
  }
}

module.exports = LeaguePlayersMessage
