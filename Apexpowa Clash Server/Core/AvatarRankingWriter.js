// Writes the player entries shared by the global (24403) and the local (24404) ranking lists:
//   INT count, then per player:
//     LONG id, STRING name, INT rank (1-based), INT score, INT previous rank,
//     INT level, INT attack wins, INT attack losses, INT defense wins, INT defense losses, INT league,
//     STRING country, LONG home id, BOOL inClan [LONG clan id, STRING clan name, INT badge]
//   INT count (again)
//
// "previous rank" was a constant 200 for everybody. The client checks a player's rank values against the size of the list
// ("Player league ranking out of bounds" is in the client), and 200 is out of bounds in a list of 11 players. It is now the
// player's own rank (nobody moved), which is always inside the list and shows no up / down arrow.
//
// The league is computed from the trophies (LeagueUtils.of), NOT read from player.league: the stored value is not kept up to
// date, so it was often 0 / wrong and the list showed no league icon.
//
// Two switches in Gamefiles/clan_event_numbers.json (no restart) to find out what a client does not accept, if it still closes:
//   "RANKING_CLAN_INFO": false      -> no clan on any entry
//   "RANKING_CLAMP_LEAGUE": true    -> league is capped at 15 (the highest league 16 is the only one the top players have)
const Switches = require('./Switches')
const LeagueUtils = require('../Utilities/LeagueUtils')

async function writeAvatarRanking (stream, db, players) {
  const clanInfo = Switches.get('RANKING_CLAN_INFO', true)
  const clampLeague = Switches.get('RANKING_CLAMP_LEAGUE', false)
  const clanCache = {}

  stream.writeInt(players.length) // PlayerCount
  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    const rank = i + 1
    const league = LeagueUtils.of(player) // from the trophies

    stream.writeLong(player.highID, player.lowID) // Id
    stream.writeString(player.name) // Name
    stream.writeInt(rank) // Rank
    stream.writeInt(player.trophies) // Score
    stream.writeInt(rank) // Previous rank (the same: no movement)

    stream.writeInt(player.level) // Level
    stream.writeInt(player.attackWinCount) // AttackWinCount
    stream.writeInt(player.attackLoseCount) // AttackLoseCount
    stream.writeInt(player.defendWinCount) // DefenseWinCount
    stream.writeInt(player.defendLoseCount) // DefenseLoseCount
    stream.writeInt(clampLeague ? Math.min(league, 15) : league) // LeagueType

    stream.writeString('US') // Country
    stream.writeLong(player.highID, player.lowID) // Home id

    let clan = null
    if (clanInfo && player.inClan && player.clan) {
      const key = `${player.clan.ClanHighID}:${player.clan.ClanLowID}`
      if (clanCache[key] === undefined) clanCache[key] = (await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)) || null
      clan = clanCache[key]
    }
    if (clan) {
      stream.writeBoolean(true)
      stream.writeLong(clan.highID, clan.lowID)
      stream.writeString(clan.name)
      stream.writeInt(clan.badge)
    } else {
      stream.writeBoolean(false)
    }
  }

  stream.writeInt(players.length)
}

module.exports = { writeAvatarRanking }
