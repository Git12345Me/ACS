const PiranhaMessage = require('../../PiranhaMessage')
const writeMemberEntry = require('./AllianceMemberEntryWriter')
const { sortMembers, refreshRanks } = require('../../../Core/ClanRanking')
const writeHeaderEntry = require('../../../Core/AllianceHeaderEntry')

class AllianceDataMessage extends PiranhaMessage {
  constructor (client, allianceId) {
    super()
    this.id = 24301
    this.client = client
    this.version = 1
    this.AllianceId = allianceId
  }

  async encode () {
    const db = this.client.mongoose
    const clan = await db.getClanByID(this.AllianceId[0], this.AllianceId[1])
    const clanHighID = clan ? clan.highID : this.AllianceId[0]
    const clanLowID = clan ? clan.lowID : this.AllianceId[1]
    const clanName = clan ? clan.name : 'Clashers'
    const clanBadge = clan ? clan.badge : 1
    const clanType = clan ? clan.type : 0
    const clanDesc = clan ? clan.description : ''
    const clanScore = clan ? clan.trophies : 0
    const clanReqScore = clan ? clan.requiredTrophies : 0
    const members = clan ? clan.members : []
    const memberCount = members.length || 0
    const location = clan ? clan.location : 0

    //if (!clan) return // if the clan doesnt exist then just return

    // AllianceFullEntry
    {
      // AllianceHeaderEntry (11 values, see Core/AllianceHeaderEntry.js)
      writeHeaderEntry(this, { highID: clanHighID, lowID: clanLowID, name: clanName, badge: clanBadge, type: clanType,
        memberCount, trophies: clanScore, requiredTrophies: clanReqScore, location })

      // AllianceFullEntry (libg.so @0x115590) after the header: STRING description, INT, BOOL with an
      // optional LONG (the id of a war the clan is in), then the INT member count and the members.
      this.writeString(clanDesc) // Description
      // WarState: 0 = the clan is not in a war. (4 = "preparation day"; with no war id to load, the client
      // keeps the war screen on "loading" forever, which is what ACS used to cause by sending 4 here.)
      this.writeInt(0) // WarState
      this.writeBoolean(false) // not in a war: no war id follows

      this.writeInt(memberCount) // MemberCount
      // A member's name, level and trophies change after they joined and clan.members is never
      // refreshed, so read each member's live player record (stored values are the fallback).
      const live = await Promise.all(members.map(async (m) => {
        try {
          const p = await db.getPlayerByID(m.highID, m.lowID)
          return p ? { ...m, name: p.name || m.name, level: p.level || m.level, league: p.league ?? m.league, trophies: p.trophies ?? m.trophies } : { ...m }
        } catch (e) {
          return { ...m }
        }
      }))

      // Order = live rank by trophies, PreviousOrder = rank at the last daily snapshot (rank arrows).
      // The snapshot is cosmetic, so a failed save must never break the clan screen.
      try {
        if (clan && refreshRanks(live)) {
          live.forEach((m, i) => { members[i].prevRank = m.prevRank; members[i].prevRankAt = m.prevRankAt })
          clan.markModified('members')
          await clan.save()
        }
      } catch (e) {}
      sortMembers(live).forEach((member, index) => writeMemberEntry(this, member, index + 1, member.prevRank || index + 1))
    }
  }
}

module.exports = AllianceDataMessage