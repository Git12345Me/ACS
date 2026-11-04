// 14310: DonateAllianceUnit - the donor taps a troop on a clan troop request.
//
// Layout (C# DonateAllianceUnitMessage.Decode):
//   INT     unit type      0 = troop, anything else = spell
//   DATAREF unit           a single INT global id here (4xxxxxx troop / 26xxxxxx spell)
//   LONG    stream id      (two INTs: high, low)
//   BOOLEAN quick donate   (1 byte)
// = 4 + 4 + 8 + 1 bytes, the same 17 bytes this file always read as
// 4 INTs + 1 BYTE.
//
// Clan side of a donation: checks the request and records the donation on the
// clan stream entry (entry.donations). The donor's own troop is removed by
// LogicDonateAllianceUnitCommand, which the client sends in its next turn, so
// nothing is taken from the player here.
//
// Not done (no data / layouts in ACS): the per-donor donation limit, XP, and
// showing the donated troops in the chat (the entry is sent with empty donation
// containers, see StreamEntryWriter).
const PiranhaMessage = require('../../PiranhaMessage')
const CSVManager = require('../../../Core/CSVManager')
const { broadcastToClan } = require('../../../Core/ClanBroadcast')
const AllianceStreamMessage = require('./AllianceStreamMessage')

const CHARACTER_CLASS = 4
const SPELL_CLASS = 26

class DonateAllianceUnitMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14310
    this.version = 1
  }

  async decode () {
    // This client's real layout (seen in the log: 4000003, 8, 0, 0, 1 with the old reading):
    //   INT unit global id (4xxxxxx troop / 26xxxxxx spell), LONG stream id (high, low), then
    //   the rest (an INT and a byte whose meaning is unknown). The old reading took the unit as
    //   "unit type" and the stream id as the unit, and the stray byte made every donation "quick donate".
    this.data = {}
    const raw = Buffer.from(this.buffer).slice(this.offset, this.offset + 24)
    this.data.Raw = raw.toString('hex')
    this.data.UnitID = this.readInt()
    const [streamHigh, streamLow] = this.readLong()
    this.data.StreamHigh = streamHigh
    this.data.StreamLow = streamLow
    this.data.UnitType = Math.floor(this.data.UnitID / 1000000) === SPELL_CLASS ? 1 : 0
    this.data.QuickDonate = false // diamond donations are not supported, and the old byte was not that flag
  }

  async process () {
    const client = this.client
    const player = client && client.player
    const db = client && client.mongoose
    const log = (text) => client.log(`[Clan] ${text}`)
    if (!player || !db) return

    const { UnitType, UnitID, QuickDonate } = this.data
    log(`14310 raw=${this.data.Raw} unit=${UnitID} stream=${this.data.StreamHigh}-${this.data.StreamLow}`)
    const classID = Math.floor(UnitID / 1000000)

    // The donor's game sends LogicDonateAllianceUnitCommand in its next turn, with the same stream id
    // and unit. EndClientTurnMessage uses this to recognise that command and learn its id.
    client.donateHint = { streamHigh: this.data.StreamHigh, streamLow: this.data.StreamLow, unitID: UnitID, at: Date.now() }

    if (classID !== CHARACTER_CLASS && classID !== SPELL_CLASS) return log(`donation ignored: unit ${UnitID} is not a troop or spell`)
    if ((UnitType !== 0) !== (classID === SPELL_CLASS)) return log(`donation ignored: unit type ${UnitType} does not match unit ${UnitID}`)
    if (QuickDonate) return log('donation refused: quick donate (diamonds) is not supported')
    if (!player.inClan || !player.clan) return log('donation ignored: player is not in a clan')

    try {
      const clan = await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      if (!clan || !Array.isArray(clan.messages)) return log('donation ignored: clan not found')

      // ACS writes the entry id in the high half of the stream id.
      const streamId = this.data.StreamHigh || this.data.StreamLow
      const entry = clan.messages.find(m => m && m.id === streamId && (m.type === 'donate' || m.type === 'troopRequest'))
      if (!entry) return log(`donation failed: troop request ${streamId} not found`)

      // C# CanAddDonation: nobody donates to their own request ...
      if (entry.senderHighID === player.highID && entry.senderLowID === player.lowID) return log('donation refused: own request')

      // ... and the castle must have room (HousingSpace from characters.csv). Entries
      // saved before castle data existed have no capacity, so they are not limited.
      if (entry.castleTotalCapacity > 0 && classID === CHARACTER_CLASS) {
        const row = CSVManager.getLevelData('characters', UnitID, 0)
        const housing = row ? row.HousingSpace || 1 : 1
        const used = (entry.donations || []).reduce((sum, d) => {
          const r = CSVManager.getLevelData('characters', d.unitID, 0)
          return sum + (d.count || 0) * (r ? r.HousingSpace || 1 : 1)
        }, 0)
        if (used + housing > entry.castleTotalCapacity) return log('donation refused: the clan castle is full')
      }

      if (!Array.isArray(entry.donations)) entry.donations = []
      if (classID === CHARACTER_CLASS) {
        const row = CSVManager.getLevelData('characters', UnitID, 0)
        entry.castleUsedCapacity = (entry.castleUsedCapacity || 0) + (row ? row.HousingSpace || 1 : 1)
      } else {
        entry.castleUsedSpellCapacity = (entry.castleUsedSpellCapacity || 0) + 1
      }
      const done = entry.donations.find(d => d.highID === player.highID && d.lowID === player.lowID && d.unitID === UnitID)
      if (done) done.count += 1
      else entry.donations.push({ highID: player.highID, lowID: player.lowID, name: player.name, unitID: UnitID, count: 1 })

      // Member list counters: +1 donated for the donor, +1 received for the requester (one per unit).
      const members = Array.isArray(clan.members) ? clan.members : []
      const donor = members.find(x => x.highID === player.highID && x.lowID === player.lowID)
      const requester = members.find(x => x.highID === entry.senderHighID && x.lowID === entry.senderLowID)
      if (donor) donor.donated = (donor.donated || 0) + 1
      if (requester) requester.donationsReceived = (requester.donationsReceived || 0) + 1

      clan.markModified('messages')
      clan.markModified('members')
      await clan.save()
      log(`${player.name} donated 1 x ${UnitID} to troop request ${streamId}`)
      // Everybody online (donor, requester, the rest) gets the updated stream so the capacity bar moves.
      await new AllianceStreamMessage(client).send()
      await broadcastToClan(player.clan.ClanHighID, player.clan.ClanLowID, c => new AllianceStreamMessage(c), client)
    } catch (e) {
      console.error(e)
    }
  }
}

module.exports = DonateAllianceUnitMessage
