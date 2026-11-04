const CastleUnits = require('../../../Core/CastleUnits')

/**
 * Command 601 - deploy a unit from the clan castle in an attack.
 * Captured: 00 00 2e 00 | 00 00 1c 00 | 00 f4 24 00 | 00 00 00 63 = x (1/512 tile), y, unit reference, tick.
 * The unit reference is 16000000 + slot (16000000 = first unit of the castle, ...). A real unit id (4000000+) is
 * accepted too. The slot is the position in the player's castle list (Core/CastleUnits.getUnits).
 * One troop is used up per placement, like 600 does for the army.
 */
class LogicPlaceAllianceAttackerCommand {
  async decode (self) {
    this.data = {}
    this.data.TroopX = self.readInt()
    this.data.TroopY = self.readInt()
    this.data.UnitRef = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    if (!player) return
    client.attackDeployed = true

    const units = CastleUnits.getUnits(player)
    const ref = Number(this.data.UnitRef)
    let entry = null
    if (Math.floor(ref / 1000000) === 16) entry = units[ref - 16000000]
    else entry = units.find(u => Number(u.unitID) === ref)

    const unitID = entry ? Number(entry.unitID) : ref
    ;(client.battleEvents = client.battleEvents || []).push({ tick: this.data.Tick, type: 'troop', x: this.data.TroopX, y: this.data.TroopY, id: unitID, castle: true, level: entry ? (entry.level || 0) : 0 })
    if (!entry) return client.log(`[Logic] castle: deployed unit ref ${ref} is not in the server's castle (${units.length} entries)`)

    if (CastleUnits.removeUnit(player, unitID, 1) > 0) {
      player.markModified('village')
      await player.save()
      client.log(`[Logic] castle: deployed UnitID ${unitID} from the clan castle (slot ${ref - 16000000})`)
    }
  }
}

module.exports = LogicPlaceAllianceAttackerCommand
