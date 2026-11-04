const WarManager = require('../../../Core/WarManager')
const StartWarFailedMessage = require('../../Messages/Server/StartWarFailedMessage')
const AllianceStreamEntryMessage = require('../../Messages/Server/AllianceStreamEntryMessage')
const { broadcastToClan } = require('../../../Core/ClanBroadcast')
const LeagueUtils = require('../../../Utilities/LeagueUtils')
const Switches = require('../../../Core/Switches')

const STARTED_WAR_EVENT = 7
// Smallest war a clan may start. It was fixed at 10, so a clan with fewer members was always refused (code 2) even though
// WarManager supports war sizes 1, 2, 3, 4, 5, 10, ... (cfg.TeamSizes). Now read from Gamefiles/clan_event_numbers.json
// ("MIN_WAR_TEAM_SIZE": 10 restores the original rule; no restart needed). Default 10: 10v10 is the smallest real war.
const minimumWarTeamSize = () => Math.max(10, Math.trunc(Switches.get('MIN_WAR_TEAM_SIZE', 10)) || 10)

/**
 * ACS port of StartClanWarCommand.
 * The server's WarManager owns war matching and map updates. This command adds the
 * native clan-stream event after a successful search.
 *
 * Layout in THIS client (from the logs): command id 560 followed by ONE INT, the tick:
 *   00 00 02 30 | 00 00 00 66
 * The old decode read a second INT (a count of excluded clans + that many LONGs), which ran 4 bytes past the end
 * of the packet ("read PAST THE END ... 4 too many") so the command was dropped and no war search ever started.
 * This client sends no excluded-clans list, so the list is empty.
 */
class LogicStartClanWarCommand {
  async decode (stream) {
    this.data = {}
    this.data.Tick = stream.readInt()
    this.data.Excluded = [] // not sent by this client
  }

  async process (stream) {
    const client = stream.client
    if (!client || !client.player) return
    WarManager.attach(client.mongoose)
    const code = await WarManager.startSearch(
      client,
      this.data.Excluded || [],
      minimumWarTeamSize()
    )
    if (code !== 0) {
      const reasons = {
        1: 'only the leader or a co-leader can start a war',
        2: 'not enough clan members for the smallest war size',
        3: 'clan not found',
        4: 'the clan is already in a war',
        5: 'the player is not in a clan'
      }
      client.log(`[War] start war refused (${code}): ${reasons[code] || 'unknown reason'}`)
      await new StartWarFailedMessage(client, 560, code).send()
      return
    }

    client.log(`[War] war search started by ${client.player.name}`)
    try {
      await saveAndBroadcastStartedEvent(client)
    } catch (error) {
      client.log(`[War] could not save/broadcast started-war event: ${error.message}`)
    }
  }
}

async function saveAndBroadcastStartedEvent (client) {
  const player = client.player
  const clanId = player.clan
  if (!player.inClan || !clanId) return

  const clan = await client.mongoose.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
  if (!clan) throw new Error('clan record was not found')
  if (!Array.isArray(clan.messages)) clan.messages = []

  const nextId = clan.messages.reduce((max, entry) => {
    const id = Number(entry && entry.id)
    return Number.isSafeInteger(id) ? Math.max(max, id) : max
  }, 0) + 1
  const entry = {
    id: nextId,
    type: 'event',
    eventType: STARTED_WAR_EVENT,
    senderHighID: player.highID,
    senderLowID: player.lowID,
    senderName: player.name || '',
    senderRole: clanId.ClanRole || 1,
    senderLevel: player.level || player.expLevel || 1,
    senderLeague: LeagueUtils.of(player),
    actorHighID: player.highID,
    actorLowID: player.lowID,
    actorName: player.name || '',
    message: `${player.name || 'A clan member'} started a war`,
    timestamp: new Date()
  }

  clan.messages.push(entry)
  if (typeof clan.markModified === 'function') clan.markModified('messages')
  if (typeof clan.save !== 'function') throw new Error('clan record cannot be saved')
  await clan.save()

  await broadcastToClan(
    clanId.ClanHighID,
    clanId.ClanLowID,
    onlineClient => new AllianceStreamEntryMessage(onlineClient, entry)
  )
}

module.exports = LogicStartClanWarCommand
