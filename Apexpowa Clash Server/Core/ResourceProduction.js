// Gold mines / elixir collectors: production over time and collecting it.
// Rates come from buildings.csv (ProducesResource, ResourcePerHour, ResourceMax). Per collector the village JSON keeps
// `collectedAt` (unix seconds of the last collect, or when it was first seen); `res_time` is sent to the game as the seconds
// of production waiting inside it (the game turns that into the amount shown on the collector).
const CSVManager = require('./CSVManager')
const { nowSeconds } = require('./ConstructionUtils')

const IGNORED_DATA = 1000017 // goblin main building (NPC village)

// Gem boost (command 526, LogicBoostBuildingCommand): a collector can be boosted for BOOST_HOURS, producing BOOST_MULTIPLIER times as much.
// The village JSON keeps `boostStart` / `boostEnd` (unix seconds) on the building. config.json -> "Boost": { "Multiplier": 10, "Hours": 24 }.
// These two numbers are the classic ones and are not in this server's data files - change them if your client shows other values.
let boostCfg = {}
try { boostCfg = require('../config.json').Boost || {} } catch (e) { boostCfg = {} }
const BOOST_MULTIPLIER = Number(boostCfg.Multiplier) > 1 ? Number(boostCfg.Multiplier) : 10
const BOOST_HOURS = Number(boostCfg.Hours) > 0 ? Number(boostCfg.Hours) : 24

// Seconds of production waiting in a collector: real time since the last collect, with the time inside the boost counted
// BOOST_MULTIPLIER times.
function effectiveSeconds (item, now) {
  const since = item.collectedAt || now
  let seconds = Math.max(0, now - since)
  const start = Number(item.boostStart) || 0
  const end = Number(item.boostEnd) || 0
  if (start && end > start) {
    const overlap = Math.min(now, end) - Math.max(since, start)
    if (overlap > 0) seconds += overlap * (BOOST_MULTIPLIER - 1)
  }
  return seconds
}

// -> { resource: 'Gold'|'Elixir'|..., field: 'gold'|'mana'|..., perHour, max } or null if this building produces nothing
function productionOf (item) {
  if (!item || item.data === IGNORED_DATA) return null
  const lvl = item.lvl || 0
  const row = CSVManager.getLevelData('buildings', item.data, lvl)
  if (!row || !row.ProducesResource) return null
  const field = CSVManager.resourceField(row.ProducesResource)
  const perHour = Number(row.ResourcePerHour) || 0
  const max = Number(row.ResourceMax) || 0
  if (!field || perHour <= 0 || max <= 0) return null
  return { resource: row.ProducesResource, field, perHour, max }
}

// Amount waiting in a collector right now (whole units, capped at the collector's maximum).
function waiting (item, prod, now = nowSeconds()) {
  return Math.min(prod.max, Math.floor(effectiveSeconds(item, now) * prod.perHour / 3600))
}

const isBoosted = (item, now = nowSeconds()) => Number(item.boostEnd) > now

// Storage capacity of the player's village for gold / elixir (same sum ClientAvatar sends as "Max:").
function storageCapacity (village) {
  const caps = { gold: 0, mana: 0 }
  for (const b of village.buildings || []) {
    const row = b && b.data !== IGNORED_DATA && CSVManager.getLevelData('buildings', b.data, b.lvl || 0)
    if (!row) continue
    caps.gold += Number(row.MaxStoredGold) || 0
    caps.mana += Number(row.MaxStoredElixir) || 0
  }
  return caps
}

// Adds res_time to every collector for the village JSON sent to the game (and starts the clock on collectors that
// have never been seen). Returns true when the village changed and must be saved.
function decorate (village, now = nowSeconds()) {
  let changed = false
  for (const item of village.buildings || []) {
    const prod = productionOf(item)
    if (!prod) continue
    if (!item.collectedAt) { item.collectedAt = now; changed = true }
    // seconds of production in the collector, never more than it takes to fill it
    item.res_time = Math.min(effectiveSeconds(item, now), Math.ceil(prod.max * 3600 / prod.perHour))
    // for the game: seconds of boost left. An old boost that ended before the last collect is forgotten.
    if (isBoosted(item, now)) item.boost_t = Number(item.boostEnd) - now
    else {
      delete item.boost_t
      if (item.boostEnd && item.collectedAt >= item.boostEnd) { delete item.boostStart; delete item.boostEnd; changed = true }
    }
  }
  return changed
}

module.exports = { productionOf, waiting, storageCapacity, decorate, isBoosted, effectiveSeconds, BOOST_MULTIPLIER, BOOST_HOURS }
