/**
 * Command 502 - UpgradeBuilding
 * Layout: INT gameObjectId, BYTE flag, INT tick (9 bytes, confirmed from live
 * traffic and the coc-messages definition; reading only 8 bytes shifted the
 * rest of the turn by one byte)
 *
 * ACS has no live Level / GameObjectManager (the old stub looked for
 * `client.level`, which never exists, so every upgrade was rejected with
 * "client.level is not available"). The village is a JSON blob on
 * `client.player.village`, so the upgrade is applied there:
 *   - validates the object and that a next level exists in the CSV data
 *   - charges the upgrade cost (BuildResource / BuildCost of the NEXT level)
 *   - starts the construction timer (`upgradeTime`, unix seconds); it is
 *     finished by ConstructionUtils (on home load, or by command 504 speed-up)
 *   - a building / trap type that is missing from the bundled CSV still gets a timer
 *     (Core/BuildFallback.js); it is never applied instantly any more
 */
const Utils = require('../../../Utilities/Utils')
const CSVManager = require('../../../Core/CSVManager')
const { nowSeconds } = require('../../../Core/ConstructionUtils')
const { xpForSeconds } = require('../../../Core/ExperienceUtils')
const { fallbackBuildSeconds } = require('../../../Core/BuildFallback')

// Sanity cap only; the client enforces the real per-building limits.
const MAX_LEVEL_INDEX = 24

const CLASS_TO_LIST = {
  500: { list: 'buildings', table: 'buildings' },
  504: { list: 'traps', table: 'traps' }
}

class LogicUpgradeBuildingCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.Unknown = self.readByte() // BYTE flag (0 in captures)
    // This client puts a -1 INT (ff ff ff ff) between the flag and the tick. Taking it as the tick left the real
    // tick to be read as the next command id (the "Unknown command 738 / 1274 / ..." errors). A real tick is
    // never -1, so: if the next INT is -1, the tick is the one after it.
    let next = self.readInt()
    if (next === -1 || next === 0xffffffff) next = self.readInt()
    this.data.Tick = next
  }

  getCommandType () {
    return 502
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => {
      if (client && typeof client.log === 'function') client.log(`[LogicUpgradeBuildingCommand] ${msg}`)
    }
    if (!player) return -1

    const id = this.data.BuildingID
    const mapping = CLASS_TO_LIST[Utils.getClassID(id)]
    if (!mapping) return log(`unsupported object class for id ${id}`), -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const items = village[mapping.list]
    const item = Array.isArray(items) ? items[Utils.getInstanceID(id)] : null
    if (!item) return log(`object ${id} not found`), -1

    if (item.upgradeTime || item.buildTime) return log(`object ${id} is already under construction`), -1

    const nextLevel = (item.lvl || 0) + 1
    // The bundled CSVs are older than the client: buildings.csv has no entries for
    // ids >= 1000019 and its level lists stop short (e.g. 10 rows where the client
    // has 11-12 levels). Rejecting those upgrades leaves the client showing a level
    // the server never saved, so they revert on reload. Instead:
    //   - level beyond the CSV  -> reuse the last known row's cost/time (getLevelData clamps)
    //   - type missing from CSV -> free, but with a timer from Core/BuildFallback.js (it used to be
    //     instant, so after a client restart the building was already upgraded)
    if (nextLevel > MAX_LEVEL_INDEX) return log(`object ${id} is already at max level`), -1
    const known = CSVManager.getMaxLevelIndex(mapping.table, item.data) >= 0
    const row = known ? CSVManager.getLevelData(mapping.table, item.data, nextLevel) : null
    // (the missing-type message is logged below, once the fallback time is known)
    if (known && nextLevel > CSVManager.getMaxLevelIndex(mapping.table, item.data)) log(`${item.data} level ${nextLevel + 1} is past the CSV; using last known cost/time`)

    // Cost: charge it if the player can afford it, otherwise reject.
    const cost = row ? (row.BuildCost || 0) : 0
    const field = row ? CSVManager.resourceField(row.BuildResource) : null
    if (cost > 0 && field) {
      if ((player[field] || 0) < cost) return log(`not enough ${row.BuildResource} (${player[field]} < ${cost})`), -1
      player[field] = player[field] - cost
      player.markModified(field)
    }

    let seconds = row ? CSVManager.buildTimeSeconds(row) : 0
    if (!known) {
      const fb = fallbackBuildSeconds(mapping.table, item.data, nextLevel)
      seconds = fb.seconds
      log(`no CSV data for ${item.data}; level ${nextLevel + 1} is free with a ${fb.source === 'override' ? 'configured' : 'ESTIMATED'} timer of ${seconds}s` +
        (fb.source === 'estimate' ? ' (add exact times to Gamefiles/build_time_overrides.json, or use the client\'s buildings.csv)' : ''))
    }
    if (seconds > 0) {
      item.upgradeTime = nowSeconds() + seconds
      item.upgradeXp = xpForSeconds(seconds) // awarded when it finishes (ConstructionUtils)
    } else {
      item.lvl = nextLevel // zero build time: instant
    }

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`object ${id} -> level ${nextLevel + 1}${seconds > 0 ? ` (${seconds}s, +${item.upgradeXp} XP when finished)` : ' (instant: zero build time in the data, e.g. walls)'}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicUpgradeBuildingCommand
