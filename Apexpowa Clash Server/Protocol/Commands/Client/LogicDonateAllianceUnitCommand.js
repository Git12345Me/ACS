// LogicDonateAllianceUnitCommand (C# LogicCommandType.DONATE_ALLIANCE_UNIT).
//
// Wire layout, matching the C# Decode (after the command id):
//   LONG    streamId        (two INTs: high, low)
//   INT     unit type       0 = troop (character), anything else = spell
//   DATAREF unit            (classID, instanceID) -> 4xxxxxx troop / 26xxxxxx spell
//   BOOLEAN quickDonate
//   INT     tick            (base LogicCommand field, read last as in the C#)
//
// Donor side of a donation: the client sends this command in its next turn after
// DonateAllianceUnitMessage (14310), which records the donation on the clan
// stream entry. From the C# Execute (non quick-donate path) this removes one of
// the unit from the donor's player.army / player.spells; if the donor has none,
// the donation fails and nothing changes.
// NOT ported (no equivalent in ACS): quick donate (always refused), the training
// queue, XP / achievements, the troop refund and the OK/Failed client notices.
//
// The command id is not registered anywhere: it is not in the protocol wiki's
// command list. If the donor's client sends it, ACS logs
// "Gotcha undefined <id> command!" - register that id in EndClientTurnMessage.
const CHARACTER_CLASS = 4
const SPELL_CLASS = 26

class LogicDonateAllianceUnitCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    const [streamHigh, streamLow] = self.readLong()
    this.data.StreamHigh = streamHigh
    this.data.StreamLow = streamLow
    this.data.UnitType = self.readInt()
    // One INT global id (4xxxxxx troop / 26xxxxxx spell), exactly as DonateAllianceUnitMessage (14310)
    // reads the same unit. readDataReference() reads two VInts, which does not match this client.
    this.data.UnitID = self.readInt()
    this.data.UnitClass = Math.floor(this.data.UnitID / 1000000)
    this.data.QuickDonate = self.readBoolean()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 0 // DONATE_ALLIANCE_UNIT: id unknown for this client, see header
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (text) => {
      if (client && typeof client.log === 'function') client.log(`[Clan] ${text}`)
    }
    if (!player) return -1

    const { UnitID, UnitClass, UnitType, QuickDonate } = this.data

    if (UnitClass !== CHARACTER_CLASS && UnitClass !== SPELL_CLASS) return log(`donation ignored: unit ${UnitID} is not a troop or spell`), 0
    if ((UnitType !== 0) !== (UnitClass === SPELL_CLASS)) return log(`donation ignored: unit type ${UnitType} does not match unit ${UnitID}`), 0
    if (QuickDonate) return log('donation refused: quick donate (diamonds) is not supported'), 0

    const listName = UnitClass === SPELL_CLASS ? 'spells' : 'army'
    const list = Array.isArray(player[listName]) ? player[listName] : []
    const slot = list.find(u => Number(u.unitID) === UnitID && Number(u.count) > 0)
    if (!slot) return log(`donation failed: no ${UnitID} in ${listName}`), 0

    slot.count = Number(slot.count) - 1
    player[listName] = list.filter(u => Number(u.count) > 0)
    player.markModified(listName)
    await player.save()
    log(`${player.name} gave away 1 x ${UnitID}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicDonateAllianceUnitCommand
