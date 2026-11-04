const LeagueUtils = require('../Utilities/LeagueUtils')
/**
 * AllianceMemberEntry - one row of a clan's member list, in the layout of THIS client's member
 * decode (libg.so @0x116468; the object is 68 bytes). Read from the binary, not from a newer
 * game's source:
 *
 *   LONG   avatarId
 *   STRING name
 *   STRING (second string, not identified; ACS sends it empty)
 *   INT    role              (1 = member, 2 = leader, 3 = elder, 4 = co-leader)
 *   INT    expLevel
 *   INT    leagueType
 *   INT    score             (trophies)
 *   INT    donations         (troops donated)
 *   INT    receivedDonations (troops received)
 *   INT    order             (current rank)
 *   INT    previousOrder     (rank before, for the up/down arrow)
 *   BOOL   isNewMember
 *   INT    warCooldown       (0 = none; the meaning of this value is not confirmed)
 *   BOOL   hasHomeId, [LONG homeId]
 *
 * The two BOOLs are separate bytes because an INT sits between them (ByteStream only packs
 * bools that are written back to back). There is no Village 2 data.
 * Longs are [high, low] arrays, which is what ByteStream.readLong() returns.
 *
 * ACS stores clan members as plain objects in clan.members; fromClanMember() builds an entry
 * from one of those and toClanMember() goes back:
 *   { highID, lowID, name, role, level, league, trophies, donated, donationsReceived, joinedAt }
 */
const ROLE = Object.freeze({ MEMBER: 1, LEADER: 2, ELDER: 3, CO_LEADER: 4 })
const SECOND_STRING_IS_NAME = true
const NEW_MEMBER_SECONDS = 259200 // 3 days
const FALLBACK_CREATED_TIME = 1000000 // members without a join date count as old

const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback)

class AllianceMemberEntry {
  constructor () {
    this.avatarId = [0, 0]
    this.homeId = null
    this.name = ''
    this.secondString = ''
    this.allianceRole = ROLE.MEMBER
    this.expLevel = 1
    this.leagueType = 0
    this.score = 0
    this.donationCount = 0
    this.receivedDonationCount = 0
    this.order = 0
    this.previousOrder = 0
    this.createdTime = 0 // seconds since the member joined (the wire only carries "is new")
    this.warCooldown = 0
  }

  decode (stream) {
    this.avatarId = stream.readLong()
    this.name = stream.readString()
    this.secondString = stream.readString()
    this.allianceRole = stream.readInt()
    this.expLevel = stream.readInt()
    this.leagueType = stream.readInt()
    this.score = stream.readInt()
    this.donationCount = stream.readInt()
    this.receivedDonationCount = stream.readInt()
    this.order = stream.readInt()
    this.previousOrder = stream.readInt()
    this.createdTime = stream.readBoolean() ? 0 : NEW_MEMBER_SECONDS // only "is new" is on the wire
    this.warCooldown = stream.readInt()
    this.homeId = stream.readBoolean() ? stream.readLong() : null
  }

  encode (stream) {
    stream.writeLong(this.avatarId[0], this.avatarId[1])
    stream.writeString(this.name)
    stream.writeString(this.secondString)
    stream.writeInt(this.allianceRole)
    stream.writeInt(this.expLevel)
    stream.writeInt(this.leagueType)
    stream.writeInt(this.score)
    stream.writeInt(this.donationCount)
    stream.writeInt(this.receivedDonationCount)
    stream.writeInt(this.order)
    stream.writeInt(this.previousOrder)
    stream.writeBoolean(this.isNewMember())
    stream.writeInt(this.warCooldown)

    if (this.homeId != null) {
      stream.writeBoolean(true)
      stream.writeLong(this.homeId[0], this.homeId[1])
    } else {
      stream.writeBoolean(false)
    }
  }

  /** Joined less than 3 days ago (the "new" flag in the member list). */
  isNewMember () {
    return this.createdTime < NEW_MEMBER_SECONDS
  }

  /** True when this member's role is lower than `role` (the check behind promote/demote/kick). */
  hasLowerRoleThan (role) {
    return AllianceMemberEntry.hasLowerRole(this.allianceRole, role)
  }

  static hasLowerRole (role1, role2) {
    switch (role2) {
      case ROLE.LEADER:
        return role1 !== ROLE.LEADER
      case ROLE.ELDER:
        return role1 === ROLE.MEMBER
      case ROLE.CO_LEADER:
        return role1 !== ROLE.LEADER && role1 !== ROLE.CO_LEADER
      default:
        return false
    }
  }

  /** Builds an entry from an ACS clan.members item. `now` is only for tests. */
  static fromClanMember (m, order = 1, previousOrder = order, now = Date.now()) {
    const entry = new AllianceMemberEntry()
    const high = int(m.highID)
    const low = int(m.lowID)

    entry.avatarId = [high, low]
    entry.homeId = [high, low]
    entry.name = String(m.name ?? '')
    // This client draws the member name from the SECOND string of the entry (an empty one leaves the
    // name blank in the member list), so the name is written in both. Set to false to send it empty.
    entry.secondString = SECOND_STRING_IS_NAME ? entry.name : ''
    entry.allianceRole = int(m.role) || ROLE.MEMBER // 0 (not in a clan / old data) counts as member
    entry.expLevel = int(m.level) || 1
    entry.leagueType = LeagueUtils.of(m)
    entry.score = int(m.trophies)
    entry.donationCount = int(m.donated)
    entry.receivedDonationCount = int(m.donationsReceived)
    entry.order = int(order)
    entry.previousOrder = int(previousOrder)

    const joinedAt = m.joinedAt ? new Date(m.joinedAt).getTime() : NaN
    entry.createdTime = Number.isFinite(joinedAt) ? Math.max(0, Math.floor((now - joinedAt) / 1000)) : FALLBACK_CREATED_TIME
    return entry
  }

  /** Back to the ACS clan.members shape. */
  toClanMember () {
    return {
      highID: this.avatarId[0],
      lowID: this.avatarId[1],
      name: this.name,
      role: this.allianceRole,
      level: this.expLevel,
      league: this.leagueType,
      trophies: this.score,
      donated: this.donationCount,
      donationsReceived: this.receivedDonationCount
    }
  }
}

AllianceMemberEntry.ROLE = ROLE
module.exports = AllianceMemberEntry
