// Shared writer for clan stream entries (24311 stream list and 24312 single entry).
//
// Stream entry types: 1 = donation request (DonateStreamEntry), 2 = chat.
//
// writeStreamEntry.donateEntries (default true; Gamefiles/clan_event_numbers.json DONATE_ENTRIES overrides it): when false,
// donation requests are sent as plain chat lines (type 2) with their text. The old (longer) donation layout was wrong for this client:
// a client that reads fewer bytes than are sent for the request entry loses its place and closes
// the connection as soon as another entry follows it in the same packet (the clan stream list).
// A single entry message hides that (the leftover bytes are ignored), which is why a request
// could show a bar but not its text while opening the chat crashed the game. Set it to true only
// for a single-entry test (see LogicRequestAllianceUnitsCommand), never for the stream list.
// Base fields (all entries) are the same, the rest depends on the type.
// DonateStreamEntry layout comes from the reference source:
//   INT castleLevel, INT castleTotalCapacity, INT castleTotalSpellCapacity,
//   INT castleUsedCapacity, INT castleUsedSpellCapacity,
//   INT donationContainerCount + containers, BOOL hasMessage (+ STRING), INT unitSlotCount (-1 = none)
// Clan events (promoted, demoted, joined, kicked, left ...) are stream entry type 4. The game draws
// them itself from its own texts (TID_STREAM_EVENT_*), so they are green and in the player's
// language without the server sending any text.
// Layout after the base fields (coc-messages "AllianceStreamEntry" extension 4):
//   INT eventType, LONG actedByAvatarId, STRING actedByName
// The base fields (name, level ...) describe the member the event is about.
// Event numbers CONFIRMED on a real client (what the game draws for each number):
//   1 = "has been kicked out of the clan by <actor>"   (red)
//   2 = "was accepted to the clan by <actor>"           (green)
//   3 = "joined the clan"                               (green)
// NOT confirmed: LEFT = 4 (a guess: the next number after joined; it should draw "left the clan" in red - check it
// with the /events 4 4 game command and correct it in Gamefiles/clan_event_numbers.json if the game shows something
// else). DEMOTED and PROMOTED are still unknown (null): they are sent as a plain chat line until a number is known.
const EVENT_TYPE = { KICKED: 1, ACCEPTED: 2, JOINED: 3, LEFT: 4, DEMOTED: null, PROMOTED: null }

// The numbers can be changed without editing code: Gamefiles/clan_event_numbers.json (see that file).
// In that file a number sets the event, false = no native event (plain chat line), null or missing = the number above.
// It is re-read whenever it changes, so a server restart is not needed to try a number.
const fs = require('fs')
const path = require('path')
const EVENT_NUMBERS_FILE = path.join('Gamefiles', 'clan_event_numbers.json')
let eventNumbersMtime = -1

function refreshEventTypes () {
  try {
    const mtime = fs.statSync(EVENT_NUMBERS_FILE).mtimeMs
    if (mtime === eventNumbersMtime) return
    eventNumbersMtime = mtime
    const file = JSON.parse(fs.readFileSync(EVENT_NUMBERS_FILE, 'utf8'))
    if (typeof file.DONATE_ENTRIES === 'boolean') writeStreamEntry.donateEntries = file.DONATE_ENTRIES // donation requests with the capacity bar + donate button
    for (const key of Object.keys(EVENT_TYPE)) {
      if (!(key in file)) continue
      const value = file[key]
      // a number sets it, false switches the native event off (plain chat line), null / anything else keeps the built-in one
      if (Number.isInteger(value) && value >= 0) EVENT_TYPE[key] = value
      else if (value === false) EVENT_TYPE[key] = null
    }
  } catch (e) { /* no file or unreadable: keep the numbers above */ }
}
const ROLE_NAME = { 1: 'Member', 2: 'Leader', 3: 'Elder', 4: 'Co-leader' }

// Text used when the event cannot be sent as a native one (unknown number, or
// writeStreamEntry.eventEntries is false).
function eventFallbackText (entry) {
  const name = String(entry.senderName ?? '')
  // Name of the event. Only a KNOWN number can identify it: comparing a blank (null) number used to
  // match the first blank entry, DEMOTED, so every event without a name was shown as "demoted".
  const kind = entry.eventName ||
    Object.keys(EVENT_TYPE).find(k => Number.isInteger(EVENT_TYPE[k]) && EVENT_TYPE[k] === entry.eventType)
  const role = ROLE_NAME[entry.newRole] || 'Member'
  if (kind === 'PROMOTED') return `${name} has been promoted to ${role}`
  if (kind === 'DEMOTED') return `${name} has been demoted to ${role}`
  if (kind === 'JOINED') return `${name} joined the clan`
  if (kind === 'LEFT') return `${name} left the clan`
  if (kind === 'KICKED') return `${name} was kicked out of the clan`
  if (kind === 'ACCEPTED') return `${name} was accepted to the clan`
  // No name and no known number (an entry saved by an older version): say the one thing that is
  // certainly true instead of showing only the name.
  if (entry.newRole) return `${name} is now ${role}`
  return `${name} (clan event)`
}

function writeStreamEntry (stream, entry) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(entry.timestamp).getTime()) / 1000))
  refreshEventTypes()
  const isRequest = entry.type === 'donate' && writeStreamEntry.donateEntries === true
  // An event saved with a name (eventName) is drawn with the CURRENT number for that name, so chat
  // history follows the table when a number is corrected. Test entries (/event) have only a number.
  const eventType = entry.type === 'event' && entry.eventName && EVENT_TYPE[entry.eventName] !== undefined
    ? EVENT_TYPE[entry.eventName]
    : entry.eventType
  const isEvent = entry.type === 'event' && writeStreamEntry.eventEntries !== false && Number.isInteger(eventType)

  const isReplay = entry.type === 'replay' // SHARE_REPLAY_PATCH
  stream.writeInt(isReplay ? 5 : isRequest ? 1 : isEvent ? 4 : 2) // StreamEntryType
  stream.writeLong(entry.id || 0) // StreamEntryId (kept as before: id in the high int)
  stream.writeLong(entry.senderHighID, entry.senderLowID) // SenderAvatarId
  stream.writeLong(entry.senderHighID, entry.senderLowID) // HomeId
  stream.writeString(String(entry.senderName ?? '')) // SenderName
  stream.writeInt(entry.senderLevel || 1) // SenderLevel
  stream.writeInt(entry.senderLeague || 0) // SenderLeagueType
  stream.writeInt(entry.senderRole || 1) // SenderRole
  stream.writeInt(ageSeconds) // AgeSeconds
  stream.writeByte(0) // IsRemoved
  if (isReplay) { // ReplayStreamEntry (libg.so class @0x12db20, type 5)
    stream.writeInt(0) // replay shard
    stream.writeLong(entry.replayHigh || 0, entry.replayLow || 0)
    stream.writeBoolean(!!entry.attack)
    stream.writeString(String(entry.message ?? ''))
    stream.writeString(String(entry.opponentName ?? ''))
    stream.writeString(String(entry.battleLog ?? '{}'))
    stream.writeInt(entry.major || 0)
    stream.writeInt(entry.build || 0)
    stream.writeInt(entry.content || 0)
    return
  }

  if (isEvent) {
    stream.writeInt(eventType) // EventType
    stream.writeLong(entry.actorHighID || 0, entry.actorLowID || 0) // ActedByAvatarId
    stream.writeString(String(entry.actorName ?? '')) // ActedByName
    return
  }

  if (!isRequest) {
    stream.writeString(String(entry.type === 'event' ? eventFallbackText(entry) : entry.message ?? ''))
    return
  }

  // Donation entry as THIS client reads it (decoded from libg.so): INT castleLevel, INT castleTotalCapacity,
  // INT castleUsedCapacity, INT donorCount (+ donors), BOOL hasMessage, [STRING message] - and nothing after the
  // message. The newer layout (spell capacities, requested unit slots at the end) is longer: the client then reads
  // every entry after the request from the wrong place and closes the connection when the stream list is sent.
  stream.writeInt(entry.castleLevel || 0)
  stream.writeInt(entry.castleTotalCapacity || 0)
  stream.writeInt(entry.castleUsedCapacity || 0)
  stream.writeInt(0) // donors: nobody has donated yet
  // Where/how the request text is written. The game keeps drawing "needs reinforcement troops" and
  // ignores the text with layout 0 (the reference layout), so other layouts can be tried:
  //   0 = BOOL hasMessage + STRING        (reference DonateStreamEntry)
  //   1 = STRING only (no flag)
  //   2 = BOOL as a full byte (1/0) + STRING
  //   3 = STRING + BOOL hasMessage
  const layout = writeStreamEntry.requestTextLayout || 0
  const text = entry.message || ''
  if (layout === 0) {
    stream.writeBoolean(!!text)
    if (text) stream.writeString(text)
  } else if (layout === 1) {
    stream.writeString(text)
  } else if (layout === 2) {
    stream.writeByte(text ? 1 : 0)
    if (text) stream.writeString(text)
  } else {
    stream.writeString(text)
    stream.writeBoolean(!!text)
  }
}

writeStreamEntry.requestTextLayout = 0
writeStreamEntry.donateEntries = true // Gamefiles/clan_event_numbers.json DONATE_ENTRIES overrides this (no restart)
writeStreamEntry.eventEntries = true // false: events are sent as plain English chat lines
writeStreamEntry.EVENT_TYPE = EVENT_TYPE
writeStreamEntry.refreshEventTypes = refreshEventTypes

module.exports = writeStreamEntry
