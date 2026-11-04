/**
 * Command 600 - PlaceAttacker
 *
 * Port of the C# LogicPlaceAttackerCommand.
 *
 * Wire format: this libg.so (RC4 protocol, v6.x) sends the command as
 *   INT x, INT y, INT unitGlobalId, INT tick
 * (see coc-messages CommandComponent id 600). The C# source belongs to a newer
 * client that uses a VInt data reference and a different LogicCommand base
 * header, so Decode() keeps ACS' original field order instead of copying the
 * newer one - copying it would desync every EndClientTurn packet.
 *
 * Execute() return codes are identical to the C# version:
 *    0  success
 *   -1  level not ready for attack      (not tracked by ACS, never returned)
 *   -2  position not passable           (needs tile map, not simulated)
 *   -3  tile does not exist             (needs tile map, not simulated)
 *   -4  invalid attack position         (needs tile map, not simulated)
 *   -5  player avatar is null
 *   -7  player has no unit of that type left
 *
 * Special ability handling (rage / cloak) is pure battle simulation that the
 * client runs itself; the server only has to keep the army counts in sync.
 */
class LogicPlaceAttackerCommand {
  async decode (self) {
    this.data = {}

    this.data.TroopX = self.readInt()
    this.data.TroopY = self.readInt()
    this.data.UnitID = self.readInt()
    this.data.Tick = self.readInt()
  }

  /**
   * Mirrors LogicPlaceAttackerCommand.Execute / PlaceAttacker:
   * validates, then removes exactly one unit (CommodityCountChangeHelper(-1)).
   */
  async execute (self) {
    const client = self.client
    const player = client.player

    if (!player) {
      client.log('LogicPlaceAttackerCommand: player is NULL')
      return -5
    }

    if (!Array.isArray(player.army)) player.army = []

    const unitID = Number(this.data.UnitID)
    client.attackDeployed = true
    ;(client.battleEvents = client.battleEvents || []).push({ tick: this.data.Tick, type: 'troop', x: this.data.TroopX, y: this.data.TroopY, id: Number(this.data.UnitID) })
    const unitIndex = player.army.findIndex(unit => Number(unit.unitID) === unitID)

    if (unitIndex === -1) {
      // not in the army camps: it is a unit donated to the clan castle, used up when placed
      if (require('../../../Core/CastleUnits').removeUnit(player, unitID, 1) > 0) {
        player.markModified('village')
        await player.save()
        client.log(`LogicPlaceAttackerCommand: deployed clan castle UnitID ${unitID}, removed from the castle`)
        return 0
      }
      client.log(`LogicPlaceAttackerCommand: UnitID ${unitID} not found in army`)
      return -7
    }

    const unit = player.army[unitIndex]
    const oldCount = Number(unit.count) || 0

    if (oldCount <= 0) {
      client.log(`LogicPlaceAttackerCommand: UnitID ${unitID} has no troops`)
      return -7
    }

    // PlaceAttacker(): avatar.CommodityCountChangeHelper(..., characterData, -1)
    unit.count = oldCount - 1

    if (unit.count <= 0) {
      player.army.splice(unitIndex, 1)
    }

    player.markModified('army')
    await player.save()

    client.log(
      `LogicPlaceAttackerCommand: deployed UnitID ${unitID} at ` +
      `(${this.data.TroopX}, ${this.data.TroopY}), ${oldCount} -> ${Math.max(0, oldCount - 1)}`
    )

    return 0
  }

  async process (self) {
    await this.execute(self)
  }

  /** Replay support (LoadFromJSON in the C# source). */
  loadFromJSON (json) {
    if (!json || json.base === undefined) {
      throw new Error('Replay LogicPlaceAttackerCommand load failed! Base missing!')
    }

    if (json.d === undefined || json.d === null) {
      throw new Error('Replay LogicPlaceAttackerCommand load failed! Character is NULL!')
    }

    this.data = {
      TroopX: json.x,
      TroopY: json.y,
      UnitID: json.d,
      Tick: json.base && json.base.t !== undefined ? json.base.t : 0
    }
  }

  /** Replay support (GetJSONForReplay in the C# source). */
  getJSONForReplay () {
    const json = { base: { t: this.data.Tick } }

    if (this.data.UnitID !== undefined) {
      json.d = this.data.UnitID
    }

    json.x = this.data.TroopX
    json.y = this.data.TroopY
    return json
  }
}

module.exports = LogicPlaceAttackerCommand
