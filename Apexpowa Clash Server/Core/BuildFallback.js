// Build / upgrade time for buildings and traps that are NOT in the bundled buildings.csv / traps.csv.
//
// The CSVs shipped with ACS are older than the client (buildings.csv only has 19 building types,
// ids 1000000-1000018; Tesla, X-Bow, Spell Factory, the Dark Elixir buildings ... are missing).
// For those, the upgrade used to be applied INSTANTLY: the client showed a countdown, the server
// saved the finished level, and after a client restart the building was already upgraded.
//
// Now an upgrade always gets a timer. Order of preference:
//   1. Gamefiles/build_time_overrides.json - exact times you enter for a building id:
//        { "1000021": [ 86400, 172800, 259200 ] }   // X-Bow: seconds to reach level 2, 3, 4 ...
//      (entry N = time to upgrade TO level N+1; past the end of the list the last value is used)
//   2. A generic estimate: the median build time, at that level, of the buildings that ARE in the
//      CSV. It is only an estimate, so the log says so.
// The proper fix is a buildings.csv / traps.csv taken from the same client build; then this file
// is no longer used for those buildings.
const fs = require('fs')
const path = require('path')
const CSVManager = require('./CSVManager')

const OVERRIDE_FILE = path.join('Gamefiles', 'build_time_overrides.json')
const MIN_SECONDS = 60
const MAX_SECONDS = 10 * 86400
const LADDER_LENGTH = 14

let overrides = null
let overridesMtime = -1
const ladders = {}

function loadOverrides () {
  try {
    const mtime = fs.statSync(OVERRIDE_FILE).mtimeMs
    if (overrides !== null && mtime === overridesMtime) return overrides
    overridesMtime = mtime
    overrides = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'))
  } catch (e) {
    if (overrides === null) overrides = {}
  }
  return overrides
}

function median (values) {
  const v = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// ladder[n] = estimated seconds to upgrade TO level index n (n = 1 is level 2).
function genericLadder (table) {
  if (ladders[table]) return ladders[table]

  const ladder = []
  for (let n = 0; n < LADDER_LENGTH; n++) {
    const values = []
    for (let id = 1000000; id < 1000060; id++) {
      const max = CSVManager.getMaxLevelIndex(table, id)
      if (max < n) continue
      const seconds = CSVManager.buildTimeSeconds(CSVManager.getLevelData(table, id, n))
      if (seconds > 0) values.push(seconds)
    }
    if (values.length) ladder[n] = Math.round(median(values))
    else ladder[n] = Math.min(MAX_SECONDS, Math.round((ladder[n - 1] || 3600) * 1.3)) // past the data: keep growing
    ladder[n] = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, ladder[n]))
  }
  ladders[table] = ladder
  return ladder
}

/**
 * @param {string} table     'buildings' or 'traps'
 * @param {number} dataId    global data id of the building, e.g. 1000021
 * @param {number} nextLevel level INDEX the building will have after the upgrade (1 = level 2)
 * @returns {{ seconds: number, source: 'override' | 'estimate' }}
 */
function fallbackBuildSeconds (table, dataId, nextLevel) {
  const list = loadOverrides()[String(dataId)]
  if (Array.isArray(list) && list.length) {
    const value = Number(list[Math.min(Math.max(nextLevel - 1, 0), list.length - 1)])
    if (Number.isFinite(value) && value >= 0) return { seconds: Math.floor(value), source: 'override' }
  }

  const ladder = genericLadder(table)
  return { seconds: ladder[Math.min(Math.max(nextLevel, 0), ladder.length - 1)], source: 'estimate' }
}

module.exports = { fallbackBuildSeconds }
