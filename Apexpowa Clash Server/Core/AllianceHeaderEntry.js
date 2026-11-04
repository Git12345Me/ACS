/**
 * AllianceHeaderEntry - the clan summary at the top of the clan screen.
 *
 * Layout read from this client's libg.so (AllianceHeaderEntry::decode @0x115A78, a 44-byte
 * object): 11 values, not the 15 ACS used to send.
 *
 *   LONG   id
 *   STRING name
 *   INT    badge          (data reference, 13000000 + badge index)
 *   INT    type           (1 = anyone can join, 2 = invite only, 3 = closed)
 *   INT    memberCount
 *   INT    score          (total trophies)
 *   INT    requiredScore  (trophies needed to join)
 *   INT    warsWon
 *   INT    warsLost
 *   INT    warsDrawn
 *   INT    locale         (data reference, 2000001 = the value ACS has always sent)
 *
 * The clan description and the member list are NOT part of the header; they follow it.
 */
function writeHeaderEntry (stream, clan) {
  stream.writeLong(clan.highID || 0, clan.lowID || 0) // Id
  stream.writeString(clan.name || '') // Name
  stream.writeInt(clan.badge || 0) // Badge
  stream.writeInt(clan.type || 1) // Type
  stream.writeInt(clan.memberCount || 0) // MemberCount
  stream.writeInt(clan.trophies || 0) // Score
  stream.writeInt(clan.requiredTrophies || 0) // RequiredScore
  stream.writeInt(clan.warsWon || 0) // WarsWon
  stream.writeInt(clan.warsLost || 0) // WarsLost
  stream.writeInt(clan.warsDrawn || 0) // WarsDrawn
  stream.writeInt(2000001) // Locale
}

module.exports = writeHeaderEntry
