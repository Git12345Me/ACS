// Obstacles (trees, stones, mushrooms...): timed clearing (obstacles.csv ClearTimeSeconds / ClearCost), the loot picked up when
// clearing ends (LootResource / LootCount) and respawning of new obstacles (globals OBSTACLE_RESPAWN_SECONDS / OBSTACLE_COUNT_MAX,
// obstacles.csv RespawnWeight).
//
// In the village JSON an obstacle being cleared has `clearEnd` (unix seconds). The copy sent to the game gets `clear_t`
// (seconds left, like `const_t` on buildings). `respawnVars.lastRespawn` (unix seconds) is when the last new obstacle appeared.
const fs = require('fs')
const path = require('path')
const CSVManager = require('./CSVManager')
const { nowSeconds } = require('./ConstructionUtils')

// Gamefiles/building_sizes.json  { "1000019": [2, 2], "1000020": [3, 3] } - footprints (width, height) of buildings, traps
// and decorations that are not in the csv files. Gamefiles/obstacles_add.json - obstacles to put into the villages (see addFromFile).
const SIZES_FILE = path.join(__dirname, '..', 'Gamefiles', 'building_sizes.json')
const ADD_FILE = path.join(__dirname, '..', 'Gamefiles', 'obstacles_add.json')
const fileCache = {}

// JSON file, re-read when it changes (no restart needed). null when it is missing or broken.
function readJson (file) {
  try {
    const m = fs.statSync(file).mtimeMs
    const c = fileCache[file]
    if (c && c.m === m) return c.data
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    fileCache[file] = { m, data }
    return data
  } catch (e) {
    return null
  }
}

// The buildings.csv of this server only lists 19 building types, so most of what a player can build (the hero altars,
// for one) has no size there. Sizes that are known without the csv:
const KNOWN_SIZES = { 1000022: [3, 3], 1000025: [3, 3] } // Barbarian King and Archer Queen altars
// When nothing says how big something is, it is treated as this size so an obstacle never grows onto it
// (the old code used 1x1, which let obstacles appear under big buildings):
const GUESS = { buildings: [3, 3], traps: [2, 2], decos: [2, 2], obstacles: [2, 2] }

const RESPAWN_SECONDS = 21600 // OBSTACLE_RESPAWN_SECONDS
const COUNT_MAX = 40 // OBSTACLE_COUNT_MAX
const OBSTACLE_BASE = 8000000
const GRID_MIN = 4
const GRID_MAX = 42 // buildable area, as in the bundled villages (4..38 are used)

function rowOf (data) {
  return CSVManager.getLevelData('obstacles', data, 0)
}

// Footprint of an object. strict = true returns null when the size is not really known (csv, building_sizes.json, KNOWN_SIZES)
// instead of guessing.
function sizeOf (list, item, strict = false) {
  const row = item && CSVManager.getLevelData(list, item.data, item.lvl || 0)
  if (row && Number(row.Width) > 0 && Number(row.Height) > 0) return { w: Number(row.Width), h: Number(row.Height) }
  const custom = readJson(SIZES_FILE)
  const known = (custom && item && custom[String(item.data)]) || (item && KNOWN_SIZES[item.data])
  if (Array.isArray(known) && known[0] > 0 && known[1] > 0) return { w: Number(known[0]), h: Number(known[1]) }
  if (strict) return null
  const guess = GUESS[list] || [2, 2]
  return { w: guess[0], h: guess[1] }
}

// Cost of clearing: { field, cost } (field = player property such as 'gold'), or null when it is free.
function clearCost (data) {
  const row = rowOf(data)
  if (!row) return null
  const cost = Number(row.ClearCost) || 0
  const field = CSVManager.resourceField(row.ClearResource)
  return cost > 0 && field ? { field, cost, resource: row.ClearResource } : null
}

function clearSeconds (data) {
  const row = rowOf(data)
  return row ? Number(row.ClearTimeSeconds) || 0 : 0
}

// Removes the obstacle from the list and gives its loot. `list` is village.obstacles. Returns a short text for the log.
function finishClearing (village, player, obstacle) {
  const i = village.obstacles.indexOf(obstacle)
  if (i >= 0) village.obstacles.splice(i, 1)
  const row = rowOf(obstacle.data)
  let loot = ''
  if (row && row.LootResource && Number(row.LootCount) > 0) {
    const field = CSVManager.resourceField(row.LootResource)
    if (field && player) {
      player[field] = (player[field] || 0) + Number(row.LootCount)
      if (typeof player.markModified === 'function') player.markModified(field)
      loot = `, +${row.LootCount} ${row.LootResource}`
    }
  }
  if (!village.respawnVars) village.respawnVars = {}
  village.respawnVars.obstacleClearCounter = (village.respawnVars.obstacleClearCounter || 0) + 1
  // a freed place starts the respawn clock if it was not running (the list was full before)
  if (!village.respawnVars.lastRespawn) village.respawnVars.lastRespawn = nowSeconds()
  return `obstacle ${obstacle.data} cleared${loot}`
}

// Clearings whose time has run out are finished. Returns the number finished.
function resolveClearing (village, player, now = nowSeconds()) {
  if (!Array.isArray(village.obstacles)) return 0
  let n = 0
  for (const o of [...village.obstacles]) {
    if (o && o.clearEnd && o.clearEnd <= now) { finishClearing(village, player, o); n++ }
  }
  return n
}

function occupied (village) {
  const taken = new Set()
  const mark = (list, items) => {
    for (const it of items || []) {
      if (!it || typeof it.x !== 'number') continue
      const { w, h } = sizeOf(list, it)
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) taken.add(`${it.x + dx},${it.y + dy}`)
    }
  }
  mark('buildings', village.buildings)
  mark('traps', village.traps)
  mark('decos', village.decos)
  mark('obstacles', village.obstacles)
  return taken
}

function pickObstacleData () {
  const table = CSVManager.tables.obstacles || []
  const options = []
  table.forEach((group, i) => {
    const w = Number(group[0] && group[0].RespawnWeight) || 0
    if (w > 0) options.push({ data: OBSTACLE_BASE + i, weight: w })
  })
  const total = options.reduce((s, o) => s + o.weight, 0)
  if (!total) return null
  let r = Math.random() * total
  for (const o of options) { r -= o.weight; if (r < 0) return o.data }
  return options[options.length - 1].data
}

// New obstacles appear every OBSTACLE_RESPAWN_SECONDS while the village has fewer than OBSTACLE_COUNT_MAX.
// Returns the number spawned.
function respawn (village, now = nowSeconds()) {
  if (!Array.isArray(village.obstacles)) village.obstacles = []
  if (!village.respawnVars) village.respawnVars = {}
  const rv = village.respawnVars
  if (!rv.lastRespawn) { rv.lastRespawn = now; return 0 }
  if (village.obstacles.length >= COUNT_MAX) { rv.lastRespawn = now; return 0 }

  let due = Math.floor((now - rv.lastRespawn) / RESPAWN_SECONDS)
  let spawned = 0
  const taken = occupied(village)
  while (due > 0 && village.obstacles.length < COUNT_MAX) {
    due--
    const data = pickObstacleData()
    if (!data) break
    const { w, h } = sizeOf('obstacles', { data })
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = GRID_MIN + Math.floor(Math.random() * (GRID_MAX - w - GRID_MIN + 1))
      const y = GRID_MIN + Math.floor(Math.random() * (GRID_MAX - h - GRID_MIN + 1))
      let free = true
      for (let dx = -1; dx <= w && free; dx++) for (let dy = -1; dy <= h && free; dy++) if (taken.has(`${x + dx},${y + dy}`)) free = false
      if (!free) continue
      village.obstacles.push({ data, x, y })
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) taken.add(`${x + dx},${y + dy}`)
      spawned++
      break
    }
    rv.lastRespawn += RESPAWN_SECONDS
  }
  if (village.obstacles.length >= COUNT_MAX) rv.lastRespawn = now
  return spawned
}

// For the village JSON sent to the game: seconds left on every clearing in progress.
function decorate (village, now = nowSeconds()) {
  for (const o of village.obstacles || []) {
    if (o && o.clearEnd && o.clearEnd > now) o.clear_t = o.clearEnd - now
    if (o) delete o.clearEnd
  }
}

// Obstacles that sit on a building, trap or decoration are removed (a village saved by the old respawn code can have them,
// for example under the hero altars). Only sizes that are really known are used, so nothing is removed on a guess.
// Returns how many were removed.
function removeOverlapping (village) {
  if (!Array.isArray(village.obstacles) || village.obstacles.length === 0) return 0
  const taken = new Set()
  for (const list of ['buildings', 'traps', 'decos']) {
    for (const it of village[list] || []) {
      if (!it || typeof it.x !== 'number') continue
      const s = sizeOf(list, it, true)
      if (!s) continue
      for (let dx = 0; dx < s.w; dx++) for (let dy = 0; dy < s.h; dy++) taken.add(`${it.x + dx},${it.y + dy}`)
    }
  }
  const before = village.obstacles.length
  village.obstacles = village.obstacles.filter(o => {
    if (!o || typeof o.x !== 'number' || o.clearEnd) return true // keep one that is being cleared
    const { w, h } = sizeOf('obstacles', o)
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) if (taken.has(`${o.x + dx},${o.y + dy}`)) return false
    return true
  })
  return before - village.obstacles.length
}

// "Gamefiles/obstacles_add.json": obstacles to put into the villages. Edit the file, no restart needed - each village gets
// them the next time it is loaded (login / refresh).
//   { "obstacles": [ { "data": 8000000, "x": 20, "y": 20 },                         // obstacles.csv id (8000000 = first row)
//                    { "name": "Large Stone", "x": 10, "y": 30 },                    // or the name from obstacles.csv
//                    { "index": 5, "x": 30, "y": 8, "player": [0, 19] },             // or the row number; only for player 0-19
//                    { "data": 8000001, "x": 5, "y": 5, "force": true } ] }          // force: also on top of buildings
// Each entry is added to a village ONCE (the village remembers it), so an obstacle the player clears does not come back.
// An entry whose place is taken by a building is skipped (and tried again next time) unless "force" is true.
// Returns how many were added.
const warned = new Set()

function resolveObstacleData (entry) {
  if (Number.isInteger(entry.data) && entry.data >= OBSTACLE_BASE) return entry.data
  if (Number.isInteger(entry.index) && entry.index >= 0) return OBSTACLE_BASE + entry.index
  if (typeof entry.name === 'string') {
    const wanted = entry.name.trim().toLowerCase()
    const i = (CSVManager.tables.obstacles || []).findIndex(group => group[0] && String(group[0].Name).toLowerCase() === wanted)
    if (i >= 0) return OBSTACLE_BASE + i
  }
  return null
}

function addFromFile (village, player) {
  const cfg = readJson(ADD_FILE)
  if (!cfg || !Array.isArray(cfg.obstacles) || cfg.obstacles.length === 0) return 0
  if (!Array.isArray(village.obstacles)) village.obstacles = []
  if (!village.addedObstacles || typeof village.addedObstacles !== 'object') village.addedObstacles = {}

  const warn = (key, text) => { if (!warned.has(key)) { warned.add(key); console.log(`[Obstacles] obstacles_add.json: ${text}`) } }
  let taken = null
  let added = 0
  cfg.obstacles.forEach((entry, n) => {
    if (!entry || typeof entry !== 'object') return
    if (Array.isArray(entry.player) && player && !(entry.player[0] === player.highID && entry.player[1] === player.lowID)) return

    const data = resolveObstacleData(entry)
    if (!data || !CSVManager.getLevelData('obstacles', data, 0)) return warn(`bad${n}`, `entry ${n + 1} has no valid obstacle (${JSON.stringify(entry)}), skipped`)
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || entry.x < 0 || entry.y < 0 || entry.x > 43 || entry.y > 43) {
      return warn(`pos${n}`, `entry ${n + 1} needs whole x and y between 0 and 43, skipped`)
    }

    const key = `${data}:${entry.x}:${entry.y}`
    if (village.addedObstacles[key]) return // already given to this village

    if (!entry.force) {
      if (!taken) taken = occupied(village)
      const { w, h } = sizeOf('obstacles', { data })
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          if (taken.has(`${entry.x + dx},${entry.y + dy}`)) return warn(`busy${key}`, `${key} is not free in a village (something is there), skipped - add "force": true to put it there anyway`)
        }
      }
    }

    village.obstacles.push({ data, x: entry.x, y: entry.y })
    village.addedObstacles[key] = 1
    if (taken) { const { w, h } = sizeOf('obstacles', { data }); for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) taken.add(`${entry.x + dx},${entry.y + dy}`) }
    added++
  })
  return added
}

module.exports = { clearCost, clearSeconds, finishClearing, resolveClearing, respawn, decorate, removeOverlapping, addFromFile, sizeOf }
