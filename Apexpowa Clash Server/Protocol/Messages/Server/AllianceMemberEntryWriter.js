// AllianceMemberEntry, written exactly as the client's decoder reads it. The layout lives in
// Core/AllianceMemberEntry.js (the client's AllianceMemberEntry::decode layout); this keeps the writeMemberEntry()
// function the callers already use:
//   writeMemberEntry(stream, clanMember, order = 1, previousOrder = order)
const AllianceMemberEntry = require('../../../Core/AllianceMemberEntry')

function writeMemberEntry (stream, m, order = 1, previousOrder = order) {
  AllianceMemberEntry.fromClanMember(m, order, previousOrder).encode(stream)
}

module.exports = writeMemberEntry
