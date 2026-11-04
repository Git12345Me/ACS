/**
 * AllianceWarMemberEntry - one member of a clan's war roster (the 200-byte object inside a war clan entry of
 * message 24335), exactly as THIS client's libg.so encodes / decodes it:
 *   encode = vtable slot 0 @0x1174C0, decode = slot 1 @0x117230, constructor (defaults) @0x117688.
 * The name in brackets is the offset of the field in the client's object.
 *
 *   LONG   clan id [+8]                LONG avatar id [+0xC]            LONG home id [+0x10]
 *   STRING name [+0x14]
 *   INT x16, in this order:
 *     bestStars [+0x48]  bestDestruction [+0x4C]  bestAttackTime [+0x50]  attacksUsed [+0x54]  defensesUsed [+0x58]
 *     lootEarned gold/elixir/dark [+0x5C +0x60 +0x64]   lootAvailable gold/elixir/dark [+0x68 +0x6C +0x70]
 *     expWeight [+0x74]  value78 [+0x78]  warState [+0x7C]  townHall [+0x44]  value80 [+0x80]
 *   BOOL   hasLiveAttacker [+0x88]  -> STRING attacker name [+0x2C], INT attacker position [+0x8C], INT [+0x90], INT [+0x94]
 *   BOOL   hasCalledBy              -> LONG [+4]
 *   BOOL   hasValue9C               -> LONG [+0x9C]        (not identified)
 *   BOOL   hasBestAttack            -> LONG [+0xA0]        (the war event of the best attack)
 *   INT    mapPosition [+0x84] (0 = top of the war map)    INT [+0xA4]   INT [+0xA8]
 *   STRING war troop request text [+0xAC]
 *   INT    itemCount [+0xC4], then per item: INT n + n x (INT data id, INT value)      (castle troops)
 * The four BOOLs are written one after the other, so ByteStream packs the ones that are not separated by another
 * value into the same byte; the client unpacks them the same way.
 *
 * Constructor defaults (what the client uses for a field nobody set): townHall -1, warState -1, value94 -1,
 * everything else 0 / empty / absent.
 *
 * warState [+0x7C] matters. The war screen finds the CURRENT player's own entry in the roster by avatar id and
 * branches on  warState == 1  and on  warState == 1 || warState == 3 , and a roster check (@0x116DCE) only passes
 * when EVERY member has 1 or 3. -1 (unset) or 0 makes the client treat the member as not taking part. 1 is used here.
 */
const STATE_IN_WAR = 1
const STATE_VALID = [1, 3]

const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d)
const long = (v) => (Array.isArray(v) ? [int(v[0]), int(v[1])] : null)

class AllianceWarMemberEntry {
  constructor () {
    this.clanId = [0, 0]
    this.avatarId = [0, 0]
    this.homeId = [0, 0]
    this.name = ''
    this.bestStars = 0
    this.bestDestruction = 0
    this.bestAttackTime = 0
    this.attacksUsed = 0
    this.defensesUsed = 0
    this.lootEarned = [0, 0, 0]
    this.lootAvailable = [0, 0, 0]
    this.expWeight = 0
    this.value78 = 0
    this.warState = -1
    this.townHall = -1
    this.value80 = 0
    this.liveAttacker = null // { name, position, value90, value94 } while somebody is attacking this base
    this.calledBy = null // LONG or null
    this.value9C = null // LONG or null
    this.bestAttackEventId = null // LONG or null
    this.mapPosition = 0
    this.valueA4 = 0
    this.valueA8 = 0
    this.troopRequestText = ''
    this.items = [] // [[{ id, value }, ...], ...]
  }

  /** true when the client's roster check (every member 1 or 3) passes for this member */
  hasValidWarState () {
    return STATE_VALID.includes(this.warState)
  }

  encode (stream) {
    stream.writeLong(this.clanId[0], this.clanId[1])
    stream.writeLong(this.avatarId[0], this.avatarId[1])
    stream.writeLong(this.homeId[0], this.homeId[1])
    stream.writeString(this.name)
    ;[this.bestStars, this.bestDestruction, this.bestAttackTime, this.attacksUsed, this.defensesUsed,
      ...this.lootEarned, ...this.lootAvailable, this.expWeight, this.value78, this.warState, this.townHall, this.value80]
      .forEach(v => stream.writeInt(int(v)))

    const live = this.liveAttacker
    stream.writeBoolean(!!live)
    if (live) {
      stream.writeString(live.name || '')
      stream.writeInt(int(live.position))
      stream.writeInt(int(live.value90))
      stream.writeInt(int(live.value94, -1))
    }
    for (const value of [this.calledBy, this.value9C, this.bestAttackEventId]) {
      stream.writeBoolean(!!value)
      if (value) stream.writeLong(value[0], value[1])
    }
    stream.writeInt(int(this.mapPosition))
    stream.writeInt(int(this.valueA4))
    stream.writeInt(int(this.valueA8))
    stream.writeString(this.troopRequestText || '')
    stream.writeInt(this.items.length)
    for (const item of this.items) {
      stream.writeInt(item.length)
      for (const slot of item) { stream.writeInt(int(slot.id)); stream.writeInt(int(slot.value)) }
    }
  }

  decode (stream) {
    this.clanId = stream.readLong()
    this.avatarId = stream.readLong()
    this.homeId = stream.readLong()
    this.name = stream.readString()
    ;[this.bestStars, this.bestDestruction, this.bestAttackTime, this.attacksUsed, this.defensesUsed] = [0, 1, 2, 3, 4].map(() => stream.readInt())
    this.lootEarned = [0, 1, 2].map(() => stream.readInt())
    this.lootAvailable = [0, 1, 2].map(() => stream.readInt())
    this.expWeight = stream.readInt()
    this.value78 = stream.readInt()
    this.warState = stream.readInt()
    this.townHall = stream.readInt()
    this.value80 = stream.readInt()

    this.liveAttacker = stream.readBoolean() ? { name: stream.readString(), position: stream.readInt(), value90: stream.readInt(), value94: stream.readInt() } : null
    this.calledBy = stream.readBoolean() ? stream.readLong() : null
    this.value9C = stream.readBoolean() ? stream.readLong() : null
    this.bestAttackEventId = stream.readBoolean() ? stream.readLong() : null
    this.mapPosition = stream.readInt()
    this.valueA4 = stream.readInt()
    this.valueA8 = stream.readInt()
    this.troopRequestText = stream.readString()
    const n = stream.readInt()
    this.items = []
    for (let i = 0; i < n; i++) {
      const slots = []
      for (let k = 0, c = stream.readInt(); k < c; k++) slots.push({ id: stream.readInt(), value: stream.readInt() })
      this.items.push(slots)
    }
  }

  /**
   * Builds an entry from a member of a WarManager side (see Core/WarManager.js) or from a plain clan member.
   *   clan  { highID, lowID }       member { highID, lowID, name, townHall, position, bestStars, bestDestruction, bestTime,
   *                                          attacks, defenses, lootEarned[3], lootAvailable[3], liveAttacker, liveAttackerPosition,
   *                                          calledBy [h, l], bestEventId, warState }
   */
  static fromMember (clan, member, name, index = 0) {
    const e = new AllianceWarMemberEntry()
    const m = member || {}
    e.clanId = [int(clan.highID), int(clan.lowID)]
    e.avatarId = [int(m.highID), int(m.lowID)]
    e.homeId = [int(m.highID), int(m.lowID)]
    e.name = String(name || m.name || '')
    e.bestStars = int(m.bestStars)
    e.bestDestruction = int(m.bestDestruction)
    e.bestAttackTime = int(m.bestTime)
    e.attacksUsed = int(m.attacks)
    e.defensesUsed = int(m.defenses)
    e.lootEarned = [0, 1, 2].map(i => int((m.lootEarned || [])[i]))
    e.lootAvailable = [0, 1, 2].map(i => int((m.lootAvailable || [])[i]))
    e.townHall = m.townHall != null ? Math.max(1, int(m.townHall, 1)) : -1
    e.expWeight = e.townHall > 0 ? e.townHall : 0 // placeholder, like Core/WarWriters.js
    e.warState = m.warState != null ? int(m.warState, -1) : STATE_IN_WAR // a roster member takes part in the war
    e.mapPosition = m.position != null ? int(m.position) : int(index)
    if (m.liveAttacker) e.liveAttacker = { name: String(m.liveAttacker), position: int(m.liveAttackerPosition), value90: 0, value94: -1 }
    e.calledBy = long(m.calledBy)
    e.bestAttackEventId = m.bestEventId != null ? [0, int(m.bestEventId)] : null
    return e
  }
}

AllianceWarMemberEntry.STATE_IN_WAR = STATE_IN_WAR
module.exports = AllianceWarMemberEntry
