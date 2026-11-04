/**
 * Command 545 - RepairTraps ("repair all" / repair the listed traps).
 * Body: int n, n x int trapId (global object id, class 504: 504000000 + index in village.traps), int tick.
 *
 * Port of the C# LogicRepairTrapsCommand:
 *   - for every listed trap that is disarmed and not being built, add its rearm cost to the total
 *     (the resource of the last such trap is charged, like the C# code);
 *   - if the player cannot pay nothing is repaired (-2); if there is nothing to repair (-1);
 *   - otherwise the cost is charged and the traps are re-armed (0).
 *
 * ACS runs no battles, so nothing marks a trap as disarmed on its own. A trap counts as disarmed when its entry in
 * village.traps has `disarmed: true` (or the original game's `needs_repair`), which whatever disarms traps later should set.
 * traps.csv here has no RearmCost column, so the rearm cost is RearmCost when the table has it, else BuildCost.
 */
const Utils = require('../../../Utilities/Utils')
const CSVManager = require('../../../Core/CSVManager')

const TRAP_CLASS = 504
const isDisarmed = t => t.disarmed === true || t.disarmed === 1 || t.needs_repair === 1 || t.needs_repair === true
const isConstructing = t => !!(t.buildTime || t.upgradeTime)

class LogicRepairTrapsCommand {
  async decode (self) {
    this.data = {}
    this.data.Ids = []
    let n = self.readInt()
    if (n < 0 || n > 200) n = 0 // the C# list holds 50; anything absurd is a misread
    for (; n > 0; n--) this.data.Ids.push(self.readInt())
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    const log = msg => { if (typeof client.log === 'function') client.log(`[RepairTraps] ${msg}`) }
    if (!player) return -1

    let village
    try { village = JSON.parse(player.village) } catch (e) { return -1 }
    const traps = Array.isArray(village.traps) ? village.traps : []

    let resource = null
    let cost = 0
    const targets = []
    for (const id of this.data.Ids) {
      if (Utils.getClassID(id) !== TRAP_CLASS) continue
      const t = traps[Utils.getInstanceID(id)]
      if (!t || !isDisarmed(t) || isConstructing(t)) continue
      const row = CSVManager.getLevelData('traps', t.data, t.lvl || 0)
      if (!row) continue
      resource = row.BuildResource
      cost += Number(row.RearmCost !== undefined && row.RearmCost !== '' ? row.RearmCost : row.BuildCost) || 0
      targets.push(t)
    }

    if (!resource || cost === 0) return log('nothing to repair'), -1
    const field = CSVManager.resourceField(resource)
    if (!field) return log(`unknown resource "${resource}"`), -1
    if (Number(player[field] || 0) < cost) return log(`not enough ${resource} (${player[field]} < ${cost})`), -2

    player[field] = Number(player[field]) - cost
    for (const t of targets) { delete t.disarmed; delete t.needs_repair } // re-armed
    player.village = JSON.stringify(village)
    for (const f of [field, 'village']) if (typeof player.markModified === 'function') player.markModified(f)
    await player.save()
    log(`${targets.length} trap(s) repaired for ${cost} ${resource}`)
    return 0
  }
}

module.exports = LogicRepairTrapsCommand
