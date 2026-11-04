// 540: the text the player typed for a troop request, followed by the tick (seen as `00 00 00 04 "test" 00 00 02 c0`,
// sent in the same turn as command 541/511 which still carries the default text "I need reinforcement troops").
// The typed text replaces the text of the player's newest troop request (if it was created a moment ago), or is kept
// for the request that follows in the same turn (LogicRequestAllianceUnitsCommand reads client.pendingRequestText).
const AllianceStreamMessage = require('../../Messages/Server/AllianceStreamMessage')
const AllianceStreamEntryMessage = require('../../Messages/Server/AllianceStreamEntryMessage')
const { broadcastToClan } = require('../../../Core/ClanBroadcast')

const WINDOW_MS = 5000

class LogicTroopRequestMessageCommand {
  async decode (self) {
    this.data = {}
    this.data.Text = self.readString() || ''
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const text = String(this.data.Text).trim().slice(0, 128)
    if (!player || !player.inClan || !player.clan || !text) return

    client.pendingRequestText = { text, at: Date.now() }
    try {
      const clan = await client.mongoose.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      const mine = (clan && clan.messages || []).filter(m => m.type === 'donate' && m.senderHighID === player.highID && m.senderLowID === player.lowID)
      const entry = mine[mine.length - 1]
      if (!entry || Date.now() - new Date(entry.timestamp).getTime() > WINDOW_MS) return // the request comes after this command
      entry.message = text
      if (typeof clan.markModified === 'function') clan.markModified('messages')
      await clan.save()
      client.pendingRequestText = null
      await new AllianceStreamEntryMessage(client, entry).send()
      await broadcastToClan(player.clan.ClanHighID, player.clan.ClanLowID, c => new AllianceStreamEntryMessage(c, entry), client)
      await new AllianceStreamMessage(client).send()
      client.log(`[Clan] troop request #${entry.id} text set to "${text}"`)
    } catch (e) {
      client.log(`[Clan] troop request text failed: ${e.message}`)
    }
  }
}

module.exports = LogicTroopRequestMessageCommand
