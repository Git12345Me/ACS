const LeagueUtils = require('../../../Utilities/LeagueUtils')
const { getReplay } = require('../../../Core/Replays')
const AllianceStreamEntryMessage = require('../../Messages/Server/AllianceStreamEntryMessage')
const { broadcastToClan } = require('../../../Core/ClanBroadcast')

/**
 * Command 542 - share a replay into the clan chat (the Share button of the Attack / Defense Log).
 * Wire layout (libg.so, vtable @0x28e988): LONG replay id, BOOL hasMessage, [STRING message], INT tick.
 * The result is a clan stream entry of type 5 (replay), see Core/StreamEntryWriter.js.
 */
class LogicShareReplayCommand {
  async decode (self) {
    this.data = {}
    const id = self.readLong()
    this.data.ReplayHigh = id[0]
    this.data.ReplayLow = id[1]
    this.data.Message = self.readBoolean() ? (self.readString() || '') : ''
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const db = client.mongoose
    if (!player || !player.inClan || !player.clan) return client.log('[Logic] replay: share ignored, not in a clan')

    const replay = getReplay(this.data.ReplayLow)
    if (!replay) return client.log(`[Logic] replay: share ignored, replay #${this.data.ReplayLow} not found`)
    const mine = (a) => a && a[0] === player.highID && a[1] === player.lowID
    const asAttacker = mine(replay.attacker)
    if (!asAttacker && !mine(replay.defender)) return client.log(`[Logic] replay: share ignored, replay #${this.data.ReplayLow} is not yours`)

    const clan = await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
    if (!clan) return client.log('[Logic] replay: share ignored, clan not found')
    if (!clan.messages) clan.messages = []
    const id = clan.messages.reduce((m, e) => Math.max(m, (e && e.id) || 0), 0) + 1
    const v = client.playerData || {}
    const entry = {
      id,
      type: 'replay',
      senderHighID: player.highID,
      senderLowID: player.lowID,
      senderName: player.name,
      senderRole: player.clan.ClanRole,
      senderLevel: player.level,
      senderLeague: LeagueUtils.of(player),
      replayHigh: 0,
      replayLow: this.data.ReplayLow,
      attack: asAttacker,
      message: String(this.data.Message).slice(0, 256),
      opponentName: (asAttacker ? replay.defenderName : replay.attackerName) || '',
      battleLog: (asAttacker ? replay.attackerJson : replay.defenderJson) || '{}',
      major: v.Major || 0,
      build: v.Minor || 0,
      content: v.Build || 0,
      timestamp: new Date()
    }
    clan.messages.push(entry)
    clan.markModified('messages')
    await clan.save()
    client.log(`[Logic] replay: ${player.name} shared replay #${this.data.ReplayLow} in the clan chat`)
    await new AllianceStreamEntryMessage(client, entry).send()
    await broadcastToClan(player.clan.ClanHighID, player.clan.ClanLowID, c => new AllianceStreamEntryMessage(c, entry), client)
  }
}

module.exports = LogicShareReplayCommand
