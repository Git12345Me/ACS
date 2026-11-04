const { getClanCastle } = require('../../../Core/ClanCastle')
const AllianceStreamEntryRemovedMessage = require('../../Messages/Server/AllianceStreamEntryRemovedMessage')
const AllianceStreamMessage = require('../../Messages/Server/AllianceStreamMessage')
const AllianceStreamEntryMessage = require('../../Messages/Server/AllianceStreamEntryMessage')

const { broadcastToClan } = require('../../../Core/ClanBroadcast')
const writeStreamEntry = require('../../Messages/Server/StreamEntryWriter')
const REFRESH_FULL_STREAM = true
// Layout finder for the request text: every request uses the next layout (0-3) of
// StreamEntryWriter and logs which one. Tell the developer the number whose request line shows
// the typed text, then set FORCE_TEXT_LAYOUT to it. null = keep cycling.
const FORCE_TEXT_LAYOUT = 0 // the layout the game was seen to draw as a donation entry (bar + donate button)
// false (default): the request is sent as a normal chat line, which every client can read. The
// donation layout is unconfirmed and can crash the chat (see StreamEntryWriter).
// true: only for a layout test - the request is sent ONCE as a single donation entry using the
// next text layout, and the full stream is not resent (it would replace the test entry). Open the
// clan chat again or log in again afterwards: the list always uses the safe chat line.
const EXPERIMENT_DONATE_ENTRY = false
let nextTextLayout = 0
// The typed text goes into the request entry itself (the line above the capacity bar).
// Set to true to ALSO post the text as a separate chat line under the request.
// Off by default: the text should show on the request itself.
const ALSO_POST_TEXT_AS_CHAT_LINE = false
const DEFAULT_REQUEST_TEXT = 'I need reinforcement troops'

// 511: "Request troops" button in the clan chat.
// Payload (after the command id): INT tick, BYTE flag, STRING message,
// e.g. 00 00 18 3a | 01 | 00 00 00 1b "I need reinforcement troops".
// Only one request per player is kept: sending a new one removes the previous one.
// The request is stored in the clan stream as a donation request entry (type 1).
// Donating to it (client message 14310) is not implemented.
class LogicRequestAllianceUnitsCommand {
  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
    this.data.Flag = typeof self.readByte === 'function' ? self.readByte() : (self.readBoolean() ? 1 : 0)
    this.data.Message = self.readString()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const db = client.mongoose

    if (!player || !player.inClan) {
      client.log('[Clan] troop request ignored: player is not in a clan')
      return
    }

    try {
      const clan = await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      if (!clan) return
      if (!Array.isArray(clan.messages)) clan.messages = []

      // One request at a time: a new request replaces the player's old one (and its capacity bar,
      // and the text line that went with it).
      // New ids must be higher than every id used so far (including the ones being removed);
      // reusing an id makes the client treat the new entry as the one it just deleted.
      const nextId = clan.messages.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1
      const old = clan.messages.filter(m =>
        m.type === 'donate' && m.senderHighID === player.highID && m.senderLowID === player.lowID)
      const oldTextLines = clan.messages.filter(m => old.some(o => o.textEntryId && o.textEntryId === m.id))
      const removed = [...old, ...oldTextLines]
      clan.messages = clan.messages.filter(m => !removed.includes(m))
      const cHigh = player.clan.ClanHighID
      const cLow = player.clan.ClanLowID
      for (const m of removed) {
        await new AllianceStreamEntryRemovedMessage(client, m.id).send()
        await broadcastToClan(cHigh, cLow, c => new AllianceStreamEntryRemovedMessage(c, m.id), client)
      }

      let typed = String(this.data.Message || '').trim()
      { const pend = client.pendingRequestText; client.pendingRequestText = null; if (pend && Date.now() - pend.at < 5000) typed = pend.text } // text from command 540
      const hasCustomText = ALSO_POST_TEXT_AS_CHAT_LINE && typed.length > 0 && typed !== DEFAULT_REQUEST_TEXT

      let layout = FORCE_TEXT_LAYOUT
      if (layout === null) { layout = nextTextLayout; nextTextLayout = (nextTextLayout + 1) % 4 }
      writeStreamEntry.requestTextLayout = layout

      const castle = getClanCastle(player)
      const entry = {
        id: nextId,
        type: 'donate',
        senderHighID: player.highID,
        senderLowID: player.lowID,
        senderName: player.name,
        senderRole: player.clan.ClanRole,
        senderLevel: player.level,
        senderLeague: player.league,
        message: typed, // shown by the game above the capacity bar
        textEntryId: hasCustomText ? nextId + 1 : 0,
        // This player's own Clan Castle (every village has its own level and capacity).
        castleLevel: castle.level,
        castleTotalCapacity: castle.totalCapacity,
        castleTotalSpellCapacity: castle.totalSpellCapacity,
        castleUsedCapacity: 0,
        castleUsedSpellCapacity: 0,
        timestamp: new Date()
      }

      clan.messages.push(entry)
      let textLine = null
      if (hasCustomText) {
        textLine = {
          id: nextId + 1,
          senderHighID: player.highID,
          senderLowID: player.lowID,
          senderName: player.name,
          senderRole: player.clan.ClanRole,
          senderLevel: player.level,
          senderLeague: player.league,
          message: typed,
          timestamp: new Date()
        }
        clan.messages.push(textLine)
      }
      const saving = clan.save() /*fast*/ // written while the request is already being sent
      saving.catch(() => {})
      // Donation entries are now the default in StreamEntryWriter (donateEntries), so the single entry and
      // the full stream below both carry the capacity bar and the donate button.
      await new AllianceStreamEntryMessage(client, entry).send()
      if (textLine) await new AllianceStreamEntryMessage(client, textLine).send()
      // Other clan members that are online now get the request (and can donate to it) right away.
      writeStreamEntry.requestTextLayout = layout
      const reached = await broadcastToClan(cHigh, cLow, c => new AllianceStreamEntryMessage(c, entry), client)
      if (textLine) await broadcastToClan(cHigh, cLow, c => new AllianceStreamEntryMessage(c, textLine), client)
      client.log(`[Clan] troop request #${entry.id} sent to ${reached} other online member(s)`)
      // The game does not always apply a single add/remove while the chat is open, so also resend the
      // whole stream (the same packet it gets when the chat is opened). If entries ever show up
      // twice in the chat, set this to false.
      // The test layout must only apply to the one entry above: the full list (also sent when the
      // chat opens or at login) always uses the normal layout, so a layout the game cannot read
      // can never break login. The list is therefore only resent for layout 0.
      writeStreamEntry.requestTextLayout = 0
      if (REFRESH_FULL_STREAM && !EXPERIMENT_DONATE_ENTRY) await new AllianceStreamMessage(client, clan).send()
      await saving // the next request must read the saved clan
      client.log(`[Clan] troop request #${entry.id} added to the clan stream (text layout ${layout}, text: "${typed}"${hasCustomText ? `, shown as chat line #${textLine.id}` : ''})`)
    } catch (e) {
      client.log(`[Clan] troop request failed: ${e.message}`)
    }
  }
}

module.exports = LogicRequestAllianceUnitsCommand
