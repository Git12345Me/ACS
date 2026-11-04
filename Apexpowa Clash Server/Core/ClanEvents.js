/**
 * Clan chat events: "<name> joined the clan" (green), "<name> has left the clan" (red), kicked, promoted, demoted.
 * They are native event entries (the game draws the name in white and the text in its own colour and language), saved
 * in the clan's chat (clan.messages) and shown at once to every clan member who is online.
 * The event numbers live in Core/StreamEntryWriter.js (and Gamefiles/clan_event_numbers.json).
 */
const PlayerManager = require('./PlayerManager')
const writeStreamEntry = require('./StreamEntryWriter') // the event numbers and the writer live in Core/
const AllianceStreamEntryMessage = require('../Protocol/Messages/Server/AllianceStreamEntryMessage')

const MAX_MESSAGES = 200

const who = p => ({
  high: p.highID,
  low: p.lowID,
  name: p.name || '',
  level: p.level || p.expLevel || 1,
  league: p.league || 0
})

/**
 * @param {object} db       the database object (db.saveClan is used when the clan has no save())
 * @param {object} clan     the clan (it must contain the entry's audience: the members who stay)
 * @param {object} e
 * @param {string} e.eventName  'JOINED' | 'LEFT' | 'KICKED' | 'PROMOTED' | 'DEMOTED' | 'ACCEPTED'
 * @param {object} e.target     the player / member the entry is about (shown as the white name)
 * @param {object} [e.actor]    who did it (for "kicked by <actor>")
 * @param {number} [e.newRole]  the target's new role (promoted / demoted)
 * @returns {object} the saved entry
 */
async function postClanEvent (db, clan, e) {
  if (typeof writeStreamEntry.refreshEventTypes === 'function') writeStreamEntry.refreshEventTypes()
  const EVENT = writeStreamEntry.EVENT_TYPE
  const t = who(e.target)
  const a = e.actor ? who(e.actor) : null

  if (!Array.isArray(clan.messages)) clan.messages = []
  const entry = {
    id: clan.messages.reduce((max, m) => Math.max(max, (m && m.id) || 0), 0) + 1,
    type: 'event',
    eventType: EVENT[e.eventName] === undefined ? null : EVENT[e.eventName], // null = no number known: sent as a chat line
    eventName: e.eventName,
    newRole: e.newRole,
    senderHighID: t.high,
    senderLowID: t.low,
    senderName: t.name,
    senderRole: e.newRole || (e.target.role || e.target.ClanRole) || 1,
    senderLevel: t.level,
    senderLeague: t.league,
    actorHighID: a ? a.high : t.high,
    actorLowID: a ? a.low : t.low,
    actorName: a ? a.name : t.name,
    timestamp: new Date()
  }
  clan.messages.push(entry)
  if (clan.messages.length > MAX_MESSAGES) clan.messages = clan.messages.slice(-MAX_MESSAGES)
  if (typeof clan.markModified === 'function') clan.markModified('messages')
  if (typeof clan.save === 'function') await clan.save()
  else if (db && typeof db.saveClan === 'function') await db.saveClan(clan)

  for (const c of PlayerManager.getAll()) {
    const p = c.player
    if (!p || !p.inClan || !p.clan) continue
    if (p.clan.ClanHighID !== clan.highID || p.clan.ClanLowID !== clan.lowID) continue
    if (c.destroyed || c.writable === false) continue
    try { await new AllianceStreamEntryMessage(c, entry).send() } catch (err) { console.error(err) }
  }
  return entry
}

module.exports = { postClanEvent }
