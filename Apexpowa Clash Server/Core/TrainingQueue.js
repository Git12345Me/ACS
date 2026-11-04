const fs = require('fs')
const path = require('path')
let CSVManager = null
try { CSVManager = require('./CSVManager') } catch (e) { CSVManager = null }

const nowSeconds = () => Math.floor(Date.now() / 1000)
const UNIT_CLASS = 4
const SPELL_CLASS = 26
const TROOP_HOUSING_DATA_ID = 1000000 // "Troop Housing" in buildings.csv
const RESOURCE_FIELD = { Gold: 'gold', Elixir: 'mana', DarkElixir: 'darkMana' }
// The matching client build has no usable spell timing table. These are approximate
// 2014 base brewing times for its three basic Elixir spells, indexed from 26000000.
const APPROX_SPELL_TRAINING_SECONDS = new Map([
  [0, 30 * 60], // Lightning
  [1, 30 * 60], // Healing
  [2, 45 * 60] // Rage
])

let unitInfo = null // Map<unitIndex, { seconds, housing, resource, cost }> (level 0 row of each unit)

/** characters.csv is read here directly (the CSVManager of some builds does not load it). */
function loadUnitInfo () {
  if (unitInfo) return unitInfo
  unitInfo = new Map()
  try {
    const text = fs.readFileSync(path.join(__dirname, '../Gamefiles/csv/characters.csv'), 'utf8').replace(/^\uFEFF/, '')
    const rows = []
    let row = []
    let field = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
        else field += c
      } else if (c === '"') quoted = true
      else if (c === ',') { row.push(field); field = '' } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' } else if (c !== '\r') field += c
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }

    const col = (name) => rows[0].indexOf(name)
    const [nameCol, timeCol, housingCol, resCol, costCol] = ['Name', 'TrainingTime', 'HousingSpace', 'TrainingResource', 'TrainingCost'].map(col)
    let index = -1
    for (const r of rows.slice(2)) { // row 1 holds the column types
      if (r[nameCol]) {
        index++
        unitInfo.set(index, {
          seconds: parseInt(r[timeCol], 10) || 0,
          housing: parseInt(r[housingCol], 10) || 1,
          resource: r[resCol],
          cost: parseInt(r[costCol], 10) || 0
        })
      }
    }
  } catch (e) {
    console.error('TrainingQueue: unable to read characters.csv', e.message)
  }
  return unitInfo
}

const infoOf = (unitID) => (Math.floor(unitID / 1000000) === UNIT_CLASS ? loadUnitInfo().get(unitID - UNIT_CLASS * 1000000) : undefined)

/** Training seconds of one troop or supported spell (0 = unknown / instant). */
function trainSeconds (unitID) {
  const classID = Math.floor(unitID / 1000000)
  if (classID === SPELL_CLASS) return APPROX_SPELL_TRAINING_SECONDS.get(unitID - SPELL_CLASS * 1000000) || 0
  const info = infoOf(unitID)
  return info ? info.seconds : 0
}
/** Army camp space of one troop. */
const housingOf = (unitID) => (infoOf(unitID) ? infoOf(unitID).housing : 1)

function giveUnit (player, unitID, count) {
  const listName = Math.floor(unitID / 1000000) === SPELL_CLASS ? 'spells' : 'army'
  if (!Array.isArray(player[listName])) player[listName] = []
  const existing = player[listName].find(u => Number(u.unitID) === unitID)
  if (existing) existing.count = (Number(existing.count) || 0) + count
  else player[listName].push({ unitID, count })
  if (typeof player.markModified === 'function') player.markModified(listName)
}

const hasQueue = (building) => building && building.unit_prod && Array.isArray(building.unit_prod.slots) && building.unit_prod.slots.length > 0

// Classic Barracks / Spell Factory boost: 4x training for one hour, costing 10 gems.
const TRAINING_BOOST_MULTIPLIER = 4
const TRAINING_BOOST_SECONDS = 3600
const TRAINING_BOOST_GEM_COST = 10

function trainingBoosts (building) {
  return (Array.isArray(building && building.trainingBoosts) ? building.trainingBoosts : [])
    .map(boost => ({
      start: Number(boost && boost.start),
      end: Number(boost && boost.end),
      multiplier: Number(boost && boost.multiplier) || TRAINING_BOOST_MULTIPLIER
    }))
    .filter(boost => Number.isFinite(boost.start) && Number.isFinite(boost.end) && boost.end > boost.start && boost.multiplier > 1)
    .sort((a, b) => a.start - b.start)
}

function activeTrainingBoost (building, now = nowSeconds()) {
  return trainingBoosts(building).find(boost => boost.start <= now && boost.end > now) || null
}

function isTrainingBoosted (building, now = nowSeconds()) {
  return Boolean(activeTrainingBoost(building, now))
}

function addTrainingBoost (building, start = nowSeconds(), duration = TRAINING_BOOST_SECONDS, multiplier = TRAINING_BOOST_MULTIPLIER) {
  if (!Array.isArray(building.trainingBoosts)) building.trainingBoosts = []
  building.trainingBoosts.push({
    start: Number(start),
    end: Number(start) + Number(duration),
    multiplier: Number(multiplier) || TRAINING_BOOST_MULTIPLIER
  })
}

// Translate a troop's required training work into a wall-clock completion time,
// applying each boost interval once. This also handles a boost starting or ending
// part-way through a troop's training.
function unitCompletionAt (building, startAt, trainingSeconds) {
  let cursor = Number(startAt)
  let remaining = Number(trainingSeconds)
  if (!Number.isFinite(cursor)) cursor = nowSeconds()
  if (!Number.isFinite(remaining) || remaining <= 0) return cursor

  for (const boost of trainingBoosts(building)) {
    if (boost.end <= cursor) continue

    if (boost.start > cursor) {
      const normalSeconds = boost.start - cursor
      if (remaining <= normalSeconds) return cursor + remaining
      remaining -= normalSeconds
      cursor = boost.start
    }

    const activeFrom = Math.max(cursor, boost.start)
    if (boost.end <= activeFrom) continue
    const multiplier = Math.max(1, boost.multiplier)
    const boostedWork = (boost.end - activeFrom) * multiplier
    if (remaining <= boostedWork) return activeFrom + remaining / multiplier
    remaining -= boostedWork
    cursor = boost.end
  }

  return cursor + remaining
}

// Keep historical boost intervals only while they can still affect this queue
// or a currently active boost may affect troops queued next.
function cleanTrainingBoosts (building, now) {
  if (!building || !Array.isArray(building.trainingBoosts)) return false
  const intervals = trainingBoosts(building)
  if (!hasQueue(building)) {
    if (intervals.some(boost => boost.start <= now && boost.end > now)) return false
    delete building.trainingBoosts
    return true
  }

  const queueStart = Number(building.unit_prod.prod_start)
  if (!Number.isFinite(queueStart)) return false
  const relevant = intervals.filter(boost => boost.end > queueStart)
  if (relevant.length === intervals.length) return false
  if (relevant.length) building.trainingBoosts = relevant
  else delete building.trainingBoosts
  return true
}

/** Total space of the finished Troop Housing buildings (Infinity when it cannot be worked out). */
function troopCapacity (village) {
  if (!CSVManager) return Infinity
  let total = 0
  let known = false
  for (const b of Array.isArray(village.buildings) ? village.buildings : []) {
    if (!b || b.data !== TROOP_HOUSING_DATA_ID || b.buildTime) continue
    const row = CSVManager.getLevelData('buildings', b.data, b.lvl || 0)
    if (row && row.HousingSpace) { total += Number(row.HousingSpace) || 0; known = true }
  }
  return known ? total : Infinity
}

/** Space the troops in the army take. */
function armyHousing (player) {
  return (Array.isArray(player.army) ? player.army : []).reduce((sum, u) => sum + (Number(u.count) || 0) * housingOf(Number(u.unitID)), 0)
}

/** Adds `count` units to the queue of a building. Returns false when it cannot train. */
function enqueue (building, unitID, count, now = nowSeconds()) {
  if (!building || !building.unit_prod || building.upgradeTime || building.buildTime) return false
  const prod = building.unit_prod
  if (!Array.isArray(prod.slots)) prod.slots = []
  if (prod.slots.length === 0) prod.prod_start = now
  const last = prod.slots[prod.slots.length - 1]
  if (last && last.id === unitID) last.cnt += count
  else prod.slots.push({ id: unitID, cnt: count })
  return true
}

/**
 * Removes up to `count` units of one kind from the END of a queue (cancel). Returns how many were
 * removed. When the unit at the head is removed completely, the next one starts now.
 */
function cancel (building, unitID, count, now = nowSeconds()) {
  if (!hasQueue(building)) return 0
  const prod = building.unit_prod
  let left = count
  for (let i = prod.slots.length - 1; i >= 0 && left > 0; i--) {
    const slot = prod.slots[i]
    if (slot.id !== unitID) continue
    const take = Math.min(slot.cnt, left)
    slot.cnt -= take
    left -= take
    if (slot.cnt <= 0) {
      prod.slots.splice(i, 1)
      if (i === 0) { prod.prod_start = now; delete prod.waiting } // a new unit starts at the head
    }
  }
  if (prod.slots.length === 0) {
    delete prod.prod_start
    delete prod.t
    delete prod.waiting
  }
  return count - left
}

/** Money back for cancelled units (the same level 0 price that was charged). */
function refund (player, unitID, count) {
  const info = infoOf(unitID)
  const field = info && RESOURCE_FIELD[info.resource]
  if (!field || info.cost <= 0 || count <= 0) return 0
  const amount = info.cost * count
  player[field] = (Number(player[field]) || 0) + amount
  if (typeof player.markModified === 'function') player.markModified(field)
  return amount
}

/** Finishes every unit whose time has passed (while the army camps have room). True when anything changed. */
function resolveVillage (village, player, now = nowSeconds()) {
  let changed = false
  let free = null // space left in the army camps, worked out when the first unit finishes

  const hasRoom = (unitID) => {
    if (free === null) free = troopCapacity(village) - armyHousing(player)
    return Math.floor(unitID / 1000000) !== UNIT_CLASS || free >= housingOf(unitID)
  }
  const take = (unitID) => { if (free !== null && Math.floor(unitID / 1000000) === UNIT_CLASS) free -= housingOf(unitID) }

  for (const building of Array.isArray(village.buildings) ? village.buildings : []) {
    if (!hasQueue(building)) {
      if (building && building.unit_prod && ('t' in building.unit_prod || 'prod_start' in building.unit_prod || 'waiting' in building.unit_prod)) {
        delete building.unit_prod.t
        delete building.unit_prod.prod_start
        delete building.unit_prod.waiting
        changed = true
      }
      if (cleanTrainingBoosts(building, now)) changed = true
      continue
    }

    const prod = building.unit_prod
    let start = Number(prod.prod_start)
    if (!start) { start = now; changed = true }

    while (prod.slots.length > 0) {
      const head = prod.slots[0]
      const seconds = trainSeconds(head.id)
      const doneAt = unitCompletionAt(building, start, seconds)
      const done = seconds <= 0 || doneAt <= now
      if (!done) break

      if (!hasRoom(head.id)) { // trained but the army camps are full: wait at the head of the queue
        if (!prod.waiting) { prod.waiting = true; changed = true }
        break
      }

      take(head.id)
      giveUnit(player, head.id, 1)
      head.cnt -= 1
      if (head.cnt <= 0) prod.slots.shift()
      if (seconds <= 0) {
        // no time known: nothing to carry over
      } else if (prod.waiting) {
        start = now // it was waiting for room: the next unit starts now
        delete prod.waiting
      } else {
        start = doneAt
      }
      changed = true
    }

    if (prod.slots.length === 0) {
      delete prod.prod_start
      delete prod.t
      delete prod.waiting
    } else if (prod.prod_start !== start) {
      prod.prod_start = start
      changed = true
    }
    if (cleanTrainingBoosts(building, now)) changed = true
  }
  return changed
}

/** Earliest time a unit finishes (0 = a finished unit is waiting for room, Infinity = nothing training). */
function nextDone (village) {
  let next = Infinity
  for (const building of Array.isArray(village.buildings) ? village.buildings : []) {
    if (!hasQueue(building)) continue
    if (building.unit_prod.waiting) return 0
    const seconds = trainSeconds(building.unit_prod.slots[0].id)
    const start = Number(building.unit_prod.prod_start) || nowSeconds()
    next = Math.min(next, unitCompletionAt(building, start, seconds))
  }
  return next
}

/** Seconds left for everything queued in a building. */
function remainingSeconds (building, now = nowSeconds()) {
  if (!hasQueue(building)) return 0
  const prod = building.unit_prod
  let cursor = Number(prod.prod_start) || now
  for (const slot of prod.slots) {
    const seconds = trainSeconds(slot.id)
    for (let i = 0; i < (Number(slot.cnt) || 0); i++) {
      if (seconds > 0) cursor = unitCompletionAt(building, cursor, seconds)
    }
  }
  return Math.max(0, Math.ceil(cursor - now))
}

/** Finishes a whole building queue now (speed up). Returns the seconds that were left. */
function finishBuilding (building, player, now = nowSeconds()) {
  const seconds = remainingSeconds(building, now)
  if (hasQueue(building)) {
    for (const slot of building.unit_prod.slots) giveUnit(player, slot.id, slot.cnt)
    building.unit_prod.slots = []
    delete building.unit_prod.prod_start
    delete building.unit_prod.t
    delete building.unit_prod.waiting
  }
  return seconds
}

/** For the client: `unit_prod.t` is the wall-clock time left for the next troop. */
function decorate (village, now = nowSeconds()) {
  for (const building of Array.isArray(village.buildings) ? village.buildings : []) {
    const hasTrainingBoostHistory = Array.isArray(building && building.trainingBoosts)
    if (hasTrainingBoostHistory) {
      const boost = activeTrainingBoost(building, now)
      if (boost) building.boost_t = Math.max(1, boost.end - now)
      else delete building.boost_t
    }
    if (hasQueue(building)) {
      const prod = building.unit_prod
      const seconds = trainSeconds(prod.slots[0].id)
      const start = Number(prod.prod_start) || now
      prod.t = Math.max(1, Math.ceil(unitCompletionAt(building, start, seconds) - now))
    }
    // Internal history is persisted in player.village but not sent to the client.
    if (hasTrainingBoostHistory) delete building.trainingBoosts
  }
}

const nextByPlayer = new WeakMap() // player -> next unit completion, so idle players cost nothing

/** Finishes the player's finished units (and saves). Safe to call on every packet. */
async function resolvePlayer (player, now = nowSeconds()) {
  if (!player || typeof player.village !== 'string' || player.village === '') return false
  const cached = nextByPlayer.get(player)
  if (cached !== undefined && now < cached) return false

  let village
  try { village = JSON.parse(player.village) } catch (e) { return false }

  const changed = resolveVillage(village, player, now)
  nextByPlayer.set(player, nextDone(village))
  if (changed) {
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
  }
  return changed
}

/** Call after the queue was changed by a command, so the next resolve looks again. */
function invalidate (player) { nextByPlayer.delete(player) }

module.exports = {
  trainSeconds, housingOf, enqueue, cancel, refund, resolveVillage, resolvePlayer,
  finishBuilding, remainingSeconds, decorate, invalidate, nextDone, troopCapacity,
  armyHousing, unitCompletionAt, isTrainingBoosted, addTrainingBoost,
  APPROX_SPELL_TRAINING_SECONDS,
  TRAINING_BOOST_MULTIPLIER, TRAINING_BOOST_SECONDS, TRAINING_BOOST_GEM_COST,
  // Keep the Barrack names as aliases for any existing integrations.
  BARRACK_BOOST_MULTIPLIER: TRAINING_BOOST_MULTIPLIER,
  BARRACK_BOOST_SECONDS: TRAINING_BOOST_SECONDS,
  BARRACK_BOOST_GEM_COST: TRAINING_BOOST_GEM_COST
}
