/**
 * Checks one clan stream entry against what THIS client's decode reads (libg.so, 24311 decode @0x1235A2,
 * entry factory @0x1249E0, StreamEntry::decode @0x124870). The client's stream decode has NO null check:
 * an entry type its factory does not know gives it a null entry and it crashes; an entry that is shorter or
 * longer than its decode reads shifts every following entry and it crashes a moment later (usually when the
 * clan chat is drawn), with nothing in the server log.
 *
 *   entry          = INT type, then:
 *   base (all)     = LONG id, LONG sender id, LONG sender home id, STRING name, INT level, INT league, INT role,
 *                    INT age, BOOL
 *   type 1 donate  = base, INT, INT, INT, INT itemCount, itemCount x (INT n, n x (INT data id, INT value)),
 *                    BOOL hasText, [STRING text]
 *   type 2 chat    = base, STRING text
 *   type 3         = base, STRING, STRING, INT
 *   type 4 event   = base, INT eventType, LONG actedBy, STRING actedByName
 *   type 5         = base, INT, LONG, BOOL, STRING, STRING, STRING, INT, INT, INT
 */
const ByteStream = require('../ByteStream')

const EVENT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] // the numbers the game draws a text for (see StreamEntryWriter)

function audit (bytes) {
  const buf = Buffer.from(bytes)
  const s = new ByteStream(buf)
  const fail = reason => ({ ok: false, reason })
  try {
    const type = s.readInt()
    if (!Number.isInteger(type) || type < 1 || type > 5) {
      return fail(`entry type ${type} is not one the client knows (1 donate, 2 chat, 3, 4 clan event, 5): it would crash the client`)
    }
    s.readLong(); s.readLong(); s.readLong(); s.readString()
    for (let i = 0; i < 4; i++) s.readInt()
    s.readBoolean()

    let eventType = null
    if (type === 2) s.readString()
    else if (type === 3) { s.readString(); s.readString(); s.readInt() } else if (type === 4) { eventType = s.readInt(); s.readLong(); s.readString() } else if (type === 5) { s.readInt(); s.readLong(); s.readBoolean(); s.readString(); s.readString(); s.readString(); s.readInt(); s.readInt(); s.readInt() } else {
      s.readInt(); s.readInt(); s.readInt()
      const items = s.readInt()
      if (items < 0 || items > 9999) return fail(`donation item count ${items} is out of range`)
      for (let i = 0; i < items; i++) {
        const n = s.readInt()
        if (n < 0 || n > 9999) return fail(`donation unit count ${n} is out of range`)
        for (let k = 0; k < n; k++) { s.readInt(); s.readInt() }
      }
      if (s.readBoolean()) s.readString()
    }

    if (s.offset > buf.length) return fail(`the client would read ${s.offset} bytes but only ${buf.length} are written (it reads past the end)`)
    if (s.offset < buf.length) return fail(`the client reads ${s.offset} bytes but ${buf.length} are written (${buf.length - s.offset} left over would be read as the next entry)`)
    if (type === 4 && !EVENT_NUMBERS.includes(eventType)) return fail(`clan event number ${eventType} has no text in the game (known: ${EVENT_NUMBERS.join(', ')})`)
    return { ok: true, type }
  } catch (e) {
    return fail(`cannot be read: ${e.message}`)
  }
}

module.exports = { audit, EVENT_NUMBERS }
