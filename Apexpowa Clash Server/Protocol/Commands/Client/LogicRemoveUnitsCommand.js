/**
 * Command 550 - LogicRemoveUnitsCommand (troop / spell deletion)
 *
 * Port of the C# LogicRemoveUnitsCommand. The wire layout below was confirmed
 * from live traffic of this libg.so client (one unit type per command):
 *
 *   INT removeType      0 = units in army camps, otherwise clan castle units
 *   INT entryCount      (always 1 in captured packets)
 *   per entry:
 *     INT unitGlobalId  (4000000+ = troop, 26000000+ = spell; data reference
 *                        is a single INT in this protocol version)
 *     INT count
 *     INT upgradeLevel
 *   INT tick
 *
 * Captured examples (6 INTs after the command id):
 *   0, 1, 4000001, 10, 0, 1464
 *   0, 1, 4000015,  1, 0,  329
 * The newer C# client puts the spell flag and removeType inside every entry;
 * this client does not send a spell flag, so spells are recognised by their id
 * (class 26). Layouts with entryCount > 1 have not been captured yet, they are
 * decoded the same way but logged as unverified.
 *
 * Execute() return codes match the C# version: 0 = ok, -1 = negative count.
 */
const MAX_ENTRIES = 256 // sanity limit so a desynced stream can't loop forever

class LogicRemoveUnitsCommand {
  async decode (self) {
    this.data = { Units: [] }

    const removeType = self.readInt()
    const size = self.readInt()

    if (size < 0 || size > MAX_ENTRIES) {
      throw new Error(`LogicRemoveUnitsCommand: invalid entry count ${size}`)
    }

    this.data.EntryCount = size

    for (let i = 0; i < size; i++) {
      const entry = {}
      entry.RemoveType = removeType
      entry.UnitID = self.readInt()
      entry.IsSpell = Math.floor(entry.UnitID / 1000000) === 26
      entry.Count = self.readInt()
      entry.UpgradeLevel = self.readInt()
      this.data.Units.push(entry)
    }

    this.data.Tick = self.readInt()

    if (size > 1 && self.client) {
      self.client.log(`LogicRemoveUnitsCommand: entryCount ${size} layout unverified, data: ${JSON.stringify(this.data)}`)
    }
  }

  async execute (self) {
    const client = self.client
    const player = client.player

    // C#: any negative count aborts the whole command.
    for (const unit of this.data.Units) {
      if (unit.Count < 0) {
        return -1
      }
    }

    if (!player || this.data.Units.length === 0) {
      return 0
    }

    let armyChanged = false
    let spellsChanged = false
    let castleChanged = false

    for (const unit of this.data.Units) {
      // removeType != 0 targets units donated to the clan castle. ACS does not
      // store donated units on the player, so there is nothing to remove.
      if (unit.RemoveType !== 0) {
        const gone = require('../../../Core/CastleUnits').removeUnit(player, unit.UnitID, unit.Count)
        if (gone > 0) {
          castleChanged = true
          client.log(`[Logic] castle: removed ${gone} of UnitID ${unit.UnitID} from the clan castle`)
        } else {
          client.log(`[Logic] castle: nothing to remove for UnitID ${unit.UnitID} (server castle: ${JSON.stringify(require('../../../Core/CastleUnits').getUnits(player))})`)
        }
        continue
      }

      const list = unit.IsSpell ? player.spells : player.army
      if (!Array.isArray(list)) continue

      const index = list.findIndex(u => Number(u.unitID) === unit.UnitID)
      if (index === -1) continue

      const stored = Number(list[index].count) || 0
      if (stored <= 0) continue

      // C#: cnt = Min(storedCount, requestedCount)
      const removed = Math.min(stored, unit.Count)
      list[index].count = stored - removed

      if (list[index].count <= 0) {
        list.splice(index, 1)
      }

      if (unit.IsSpell) spellsChanged = true
      else armyChanged = true

      client.log(`LogicRemoveUnitsCommand: removed ${removed} of UnitID ${unit.UnitID}`)
    }

    if (armyChanged) player.markModified('army')
    if (spellsChanged) player.markModified('spells')
    if (armyChanged || spellsChanged || castleChanged) await player.save()

    return 0
  }

  async process (self) {
    await this.execute(self)
  }
}

module.exports = LogicRemoveUnitsCommand
