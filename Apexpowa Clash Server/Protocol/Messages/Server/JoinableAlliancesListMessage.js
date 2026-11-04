const PiranhaMessage = require('../../PiranhaMessage')

// Layout finder for the join-clan list (24304).
//
// Known so far: 0 clans -> client survives; 6 clans with a 15/16-field entry and no
// leading string -> client closes; 6 clans laid out like the search packet (24310, leading
// empty string, 15 fields) -> client survives but shows NO clans. So the data is being read
// but rejected/misaligned. Each time the join screen is opened this message now sends the
// NEXT layout from VARIANTS and logs "[Joinable] variant N: ...". Open the join screen up
// to 8 times; when the clans show up, note the variant number from the log and tell it to
// the developer, then set FORCE_VARIANT to that number (0-7) to stop cycling.
//
// header = write an empty STRING before the count (like 24310)
// win    = write a trailing winStreak INT after each clan (16 fields instead of 15)
// origin = write AllianceOrigin as a global data id (32000000 + location) instead of the raw
//          location index
const VARIANTS = [
  { header: false, win: false, origin: false },
  { header: true, win: true, origin: false },
  { header: false, win: true, origin: false },
  { header: true, win: false, origin: true },
  { header: false, win: false, origin: true },
  { header: true, win: true, origin: true },
  { header: false, win: true, origin: true },
  { header: true, win: false, origin: false } // identical to 24310 (already tried: no clans shown)
]
const FORCE_VARIANT = null // e.g. 3 once the working layout is known
let nextVariant = 0

class JoinableAlliancesListMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24304
    this.client = client
    this.version = 1
  }

  async encode () {
    const db = this.client.mongoose
    //const clans = await db.getJoinableClans(20) // TODO: Joinable clans
    let clans = await db.searchClans('', 20)

    // Print exactly what is about to be sent, so a bad value stands out.
    clans.forEach((c, i) => this.client.log(
      `[Joinable] #${i} ${c.highID}-${c.lowID} "${c.name}" badge=${c.badge} type=${c.type} ` +
      `members=${c.members?.length || 0} trophies=${c.trophies} req=${c.requiredTrophies} location=${c.location}`))

    let n = FORCE_VARIANT
    if (n === null || n === undefined) {
      n = nextVariant
      nextVariant = (nextVariant + 1) % VARIANTS.length
    }
    const v = VARIANTS[n]
    this.client.log(`[Joinable] variant ${n}: header=${v.header} winStreak=${v.win} originGlobal=${v.origin}, sending ${clans.length} clan(s)`)

    if (v.header) this.writeString('') // same leading field as AllianceListMessage (24310)
    this.writeInt(clans.length) // AlliancesCount
    for (const clan of clans) {
      this.writeLong(clan.highID, clan.lowID) // Id
      this.writeString(clan.name) // Name
      this.writeInt(clan.badge) // Badge
      this.writeInt(clan.type) // Type
      this.writeInt(clan.members?.length || 0) // MembersCount
      this.writeInt(clan.trophies) // Score
      this.writeInt(clan.requiredTrophies) // RequiredScore
      this.writeInt(0) // WonWars
      this.writeInt(0) // LostWars
      this.writeInt(0) // DrawWars
      this.writeInt(2000001)
      this.writeInt(0) // WarFrequency
      this.writeInt(v.origin ? 32000000 + (clan.location || 0) : (clan.location || 0)) // AllianceOrigin
      this.writeInt(0) // AllianceExperience
      this.writeInt(1) // AllianceLevel
      if (v.win) this.writeInt(0) // WinStreak
    }
  }
}

module.exports = JoinableAlliancesListMessage
