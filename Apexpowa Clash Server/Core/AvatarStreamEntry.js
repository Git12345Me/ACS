/*
 * The player's own stream ("inbox"): clan mail, invitations and so on. Entries are saved in player.inbox and
 * sent as 24411 (the whole list, at login) or 24412 (one new entry).
 *
 * Wire layout of an entry, read from THIS client's libg.so (24412 decode @0x12560C, entry factory @0x125516,
 * AvatarStreamEntry::decode @0x1253BC):
 *   INT  type                    4 = clan invitation, 6 = clan mail   (the only two ACS sends)
 *   LONG entry id
 *   LONG sender avatar id        <- directly after the entry id: there is NO "has sender" flag
 *   STRING sender name
 *   INT  sender level, INT league, INT age in seconds
 *   BOOL, BOOL                   (False, True: packed in one byte)
 * then, for type 6 (clan mail):
 *   STRING text
 *   BOOL hasLong [LONG]          (absent)
 *   LONG clan id, STRING clan name, INT clan badge
 * and for type 4 (clan invitation):
 *   LONG clan id, STRING clan name, INT clan badge
 *   BOOL hasLong [LONG]          (absent)
 *   (nothing else: the old writer added a state INT and one more BOOL that the client does not read)
 *
 * The old writer put a BOOL (hasSender = true) in front of the sender id. The client read that byte as the first
 * byte of the sender id, so every field after it was shifted by one byte and the game closed the connection as
 * soon as the entry arrived (24412) or the inbox list was opened (24411).
 *
 * Two shapes of an entry are accepted (they describe the same thing):
 *   inbox entry : { type: 6, id, senderHighID, senderLowID, senderName, senderLevel, senderLeague, timestamp, message,
 *                   clanHighID, clanLowID, clanName, clanBadge }
 *   MailStore   : { type: 'clanMail', id, senderHighID, ..., time, message, allianceHighID, allianceLowID, allianceName,
 *                   allianceBadge }        (what LogicSendAllianceMailCommand creates)
 * writeClanMail(stream, entry) writes one clan mail entry (stream first or entry first, both work).
 */
const CLAN_INVITATION = 4
const CLAN_MAIL = 6
const MAX_INBOX = 50
const MAX_TEXT = 256

const TYPE_BY_NAME = { clanInvitation: 4, clanMail: CLAN_MAIL }

/** the same entry with one set of field names, whichever shape it came in */
function normalize (entry) {
  const e = entry || {}
  const type = typeof e.type === 'string' ? (TYPE_BY_NAME[e.type] || CLAN_MAIL) : (e.type || CLAN_MAIL)
  return Object.assign({}, e, {
    type,
    timestamp: e.timestamp || e.time || Date.now(),
    clanHighID: e.clanHighID !== undefined ? e.clanHighID : e.allianceHighID,
    clanLowID: e.clanLowID !== undefined ? e.clanLowID : e.allianceLowID,
    clanName: e.clanName !== undefined ? e.clanName : e.allianceName,
    clanBadge: e.clanBadge !== undefined ? e.clanBadge : e.allianceBadge
  })
}

function writeAvatarStreamEntry (stream, rawEntry) {
  const entry = normalize(rawEntry)
  const age = Math.max(0, Math.floor((Date.now() - new Date(entry.timestamp).getTime()) / 1000))
  stream.writeInt(entry.type)
  stream.writeLong(0, entry.id || 0) // entry id
  stream.writeLong(entry.senderHighID || 0, entry.senderLowID || 0) // sender avatar id (no flag before it)
  stream.writeString(entry.senderName || '')
  stream.writeInt(entry.senderLevel || 1)
  stream.writeInt(entry.senderLeague || 0)
  stream.writeInt(age)
  stream.writeBoolean(false)
  stream.writeBoolean(true)

  if (entry.type === CLAN_MAIL) {
    stream.writeString(entry.message || '')
    stream.writeBoolean(false) // no extra long
    stream.writeLong(entry.clanHighID || 0, entry.clanLowID || 0)
    stream.writeString(entry.clanName || '')
    stream.writeInt(entry.clanBadge || 0)
  } else if (entry.type === CLAN_INVITATION) {
    stream.writeLong(entry.clanHighID || 0, entry.clanLowID || 0)
    stream.writeString(entry.clanName || '')
    stream.writeInt(entry.clanBadge || 0)
    stream.writeBoolean(false) // no extra long
  }
}

/** One clan mail entry (type 6). Accepts (stream, entry) or (entry, stream). */
function writeClanMail (a, b) {
  const stream = typeof a.writeInt === 'function' ? a : b
  const entry = stream === a ? b : a
  return writeAvatarStreamEntry(stream, Object.assign({}, entry, { type: CLAN_MAIL }))
}

/** Adds an entry to a player record (id = next free id in that player's inbox), keeping the newest MAX_INBOX. */
function addToInbox (player, entry) {
  if (!Array.isArray(player.inbox)) player.inbox = []
  const id = player.inbox.reduce((max, e) => Math.max(max, (e && e.id) || 0), 0) + 1
  const copy = Object.assign({}, entry, { id })
  player.inbox.push(copy)
  if (player.inbox.length > MAX_INBOX) player.inbox = player.inbox.slice(-MAX_INBOX)
  if (typeof player.markModified === 'function') player.markModified('inbox')
  return copy
}

module.exports = { CLAN_INVITATION, CLAN_MAIL, MAX_TEXT, writeAvatarStreamEntry, writeClanMail, addToInbox, normalize }
