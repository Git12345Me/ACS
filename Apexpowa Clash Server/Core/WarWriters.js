/**
 * Core/WarWriters.js - wire writers for clan-war structures, using the supplied libg.so layout.
 * Field order is the order the client's decoders read them (0x20849c, 0x208178, 0x208b7c, 0x2155fc).
 * bool is bit-packed by ByteStream.writeBoolean; any int/long/string write resets the bit position,
 * exactly like the client reader, so runs of bools need no special handling here.
 */

// Replay version the client expects on attack events: major 8, build 709, content version.
const REPLAY_VERSION = [8, 709, 0]
const AllianceWarMemberEntry = require('./AllianceWarMemberEntry')

// Exp block sent with every clan entry (wars.md 2.2 / 7 / 12.7). The client falls back to 0 for every
// exp getter when `use` is false, so the block is always sent. These numbers are placeholders except
// WIN_BONUS_EXP (50); tune them in config.json -> War.Exp.
const DEFAULT_EXP = {
  byStrength: false,
  positionExp: Array.from({ length: 50 }, () => 10),
  multiplier: 1,
  starsBonus1: 10,
  starsBonus2: 20,
  winBonus: 50,
  pct1: 50,
  pct2: 100
}

function writeHeader (s, clan) {
  s.writeLong(clan.highID, clan.lowID) // +0 clan id
  s.writeString(clan.name) // +8 name
  s.writeInt(clan.badge) // +0x18 badge
  s.writeInt(clan.level) // +0x1c level
  s.writeInt(0) // +0x20 unknown
}

/**
 * War member, in the order THIS client decodes it (libg.so @0x117230; same layout as WarDataMessage.js, which the
 * user's own tree writes from that decoder). The wars document for build 8.709 orders the fields differently (map
 * position before the live block, 4 values after the live name, castle capacity, donor list); this client's header
 * is also the 11-value one, so it is not that build and its order is used here.
 */
function writeMember (s, clan, m, index = 0) {
  return AllianceWarMemberEntry.fromMember(clan, m, m.name, index).encode(s)
}

/** Clan entry in this client's order: id, name, badge, member count, members (no level, no exp block). */
function writeEntry (s, clan) {
  s.writeLong(clan.highID, clan.lowID)
  s.writeString(clan.name || '')
  s.writeInt(clan.badge || 0)
  s.writeInt(clan.members.length)
  clan.members.forEach((m, i) => writeMember(s, clan, m, i))
}

function writeEvent (s, e, now = Date.now()) {
  s.writeLong(0, e.id) // +4 event id
  s.writeInt(Math.max(0, Math.floor((now - e.time) / 1000))) // +8 age
  s.writeLong(e.attackerClan[0], e.attackerClan[1]) // +0x10
  s.writeLong(e.attackerId[0], e.attackerId[1]) // +0x14
  s.writeLong(e.defenderClan[0], e.defenderClan[1]) // +0x18
  s.writeLong(e.defenderId[0], e.defenderId[1]) // +0x1c
  s.writeString(e.attackerName) // +0x20
  s.writeString(e.defenderName) // +0x34
  s.writeInt(e.stars) // +0x48
  s.writeInt(e.newStars) // +0x4c
  s.writeInt(e.destruction) // +0x50
  s.writeInt(e.duration) // +0x54
  for (const v of REPLAY_VERSION) s.writeInt(v) // +0x60/+0x64/+0x68
  s.writeBoolean(false) // has replay (ACS does not record war replays)
  s.writeInt(0) // +0x6c
}

module.exports = { writeHeader, writeMember, writeEntry, writeEvent, DEFAULT_EXP, REPLAY_VERSION }
