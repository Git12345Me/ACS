/**
 * Core/BattleSim.js - server side battle simulation (approximation).
 *
 * The game client simulates the fight itself and only sends the placement commands (600 troop, 605 hero,
 * 604 spell) and the tick where the battle ended (603). This replays those commands against the enemy
 * village with the stats from characters.csv / heroes.csv / buildings.csv to get the destruction %,
 * the stars and whether the Town Hall fell - which decide the trophies and the loot.
 *
 * Simplifications (so the result can differ a little from the client's own number):
 *   - walls are ignored (troops walk through them), traps / spells / hero abilities are not simulated
 *   - units go straight to the nearest valid building (preferred building class first)
 *   - defenders: every building with Damage + AttackRange shoots the nearest unit in range
 *   - 1 tile = 100 range / speed units, one tick = 1 / ticksPerSecond (default 20) seconds
 */
const fs = require('fs')
const path = require('path')
const CSVManager = require('./CSVManager')

const CSV_DIR = path.join(__dirname, '..', 'Gamefiles', 'csv')

function splitCsv (line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

let HEROES = null
function loadHeroes () {
  if (HEROES) return HEROES
  HEROES = []
  try {
    const lines = fs.readFileSync(path.join(CSV_DIR, 'heroes.csv'), 'utf8').replace(/\r/g, '').split('\n').filter(l => l.length)
    const head = splitCsv(lines[0]); let cur = null; let prev = null
    for (let i = 2; i < lines.length; i++) {
      const cells = splitCsv(lines[i])
      if (cells[0]) { cur = []; HEROES.push(cur); prev = null }
      if (!cur) continue
      const row = {}
      head.forEach((h, k) => { row[h] = (cells[k] === undefined || cells[k] === '') && prev ? prev[h] : cells[k] })
      cur.push(row); prev = row
    }
  } catch (e) { console.log('[Logic] battle: heroes.csv not loaded:', e.message) }
  return HEROES
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const truthy = v => String(v).toLowerCase() === 'true'

function troopStats (id, level) {
  const cls = Math.floor(id / 1000000)
  let row = null
  if (cls === 28) { const g = loadHeroes()[id % 1000000]; row = g && g[Math.max(0, Math.min(level, g.length - 1))] } else row = CSVManager.getLevelData('characters', id, level)
  if (!row) return null
  return {
    hp: num(row.Hitpoints), speed: num(row.Speed) / 100, range: Math.max(0.4, num(row.AttackRange) / 100),
    every: Math.max(100, num(row.AttackSpeed)) / 1000, dmg: num(row.Damage) * (num(row.PreferedTargetDamageMod) > 1 ? 1 : 1),
    prefClass: row.PreferedTargetBuildingClass || '', prefBuilding: row.PreferedTargetBuilding || '', mod: num(row.PreferedTargetDamageMod) || 1,
    flying: truthy(row.IsFlying), splash: num(row.DamageRadius) / 100, hero: cls === 28, housing: num(row.HousingSpace)
  }
}

function buildingList (village) {
  const list = []
  for (const b of village.buildings || []) {
    if (!b) continue
    const row = CSVManager.getLevelData('buildings', b.data, b.lvl || 0)
    if (!row) continue
    const cls = row.BuildingClass || ''
    const w = num(row.Width) || 1; const h = num(row.Height) || 1
    list.push({
      data: b.data, cls, wall: cls === 'Wall', th: b.data === 1000001,
      x: num(b.x) + w / 2, y: num(b.y) + h / 2, half: Math.max(w, h) / 2,
      hp: num(row.Hitpoints) || 1, maxhp: num(row.Hitpoints) || 1,
      range: num(row.AttackRange) / 100, minRange: num(row.MinAttackRange) / 100,
      every: Math.max(100, num(row.AttackSpeed)) / 1000, dmg: num(row.Damage),
      air: truthy(row.AirTargets), ground: truthy(row.GroundTargets), splash: num(row.DamageRadius) / 100,
      cd: 0, dead: false, resource: cls === 'Resource'
    })
  }
  return list
}

/**
 * events: [{ tick, type: 'troop'|'hero'|'spell', x, y, id }]  (x / y in 1/512 tile)
 * levels: { unit(id) -> level index, hero(id) -> level index }
 */
function simulate (village, events, endTick, levels = {}, opts = {}) {
  const tps = opts.ticksPerSecond || 20
  const dt = 1 / tps
  const buildings = buildingList(village)
  const targets = buildings.filter(b => !b.wall)
  const total = targets.length
  const ev = events.filter(e => e.type !== 'spell').sort((a, b) => a.tick - b.tick)
  const result = { percent: 0, stars: 0, townHall: false, destroyed: 0, total, ticks: 0 }
  if (!total || !ev.length) return result

  const t0 = ev[0].tick
  const last = Math.min(endTick > t0 ? endTick : t0 + 180 * tps, t0 + 180 * tps)
  const units = []
  let next = 0
  for (let tick = t0; tick <= last; tick++) {
    while (next < ev.length && ev[next].tick <= tick) {
      const e = ev[next++]
      const st = troopStats(e.id, e.type === 'hero' ? (levels.hero ? levels.hero(e.id) : 0) : (levels.unit ? levels.unit(e.id) : 0))
      if (st && st.hp > 0) units.push({ ...st, x: e.x / 512, y: e.y / 512, hpNow: st.hp, cd: 0, target: null })
    }
    const alive = units.filter(u => u.hpNow > 0)
    // units
    for (const u of alive) {
      if (!u.target || u.target.dead) {
        let best = null; let bd = Infinity
        const pool = targets.filter(b => !b.dead)
        let cand = pool
        if (u.prefClass) { const p = pool.filter(b => b.cls === u.prefClass); if (p.length) cand = p }
        for (const b of cand) { const d = Math.hypot(b.x - u.x, b.y - u.y); if (d < bd) { bd = d; best = b } }
        u.target = best
      }
      const t = u.target
      if (!t) continue
      const dist = Math.hypot(t.x - u.x, t.y - u.y) - t.half
      if (dist > u.range) {
        const step = Math.min(u.speed * dt, dist - u.range + 0.01)
        const d = Math.hypot(t.x - u.x, t.y - u.y) || 1
        u.x += (t.x - u.x) / d * step; u.y += (t.y - u.y) / d * step
      } else {
        u.cd -= dt
        while (u.cd <= 0) {
          u.cd += u.every
          const dmg = u.dmg * (u.prefClass && t.cls === u.prefClass ? u.mod : 1)
          t.hp -= dmg
          if (u.splash > 0) for (const o of targets) if (o !== t && !o.dead && Math.hypot(o.x - t.x, o.y - t.y) <= u.splash) o.hp -= dmg * 0.5
          if (t.hp <= 0) break
        }
      }
    }
    for (const b of targets) if (!b.dead && b.hp <= 0) b.dead = true
    // defenders
    for (const b of buildings) {
      if (b.dead || !(b.dmg > 0) || !(b.range > 0)) continue
      b.cd -= dt
      if (b.cd > 0) continue
      let tgt = null; let bd = Infinity
      for (const u of alive) {
        if (u.hpNow <= 0) continue
        if (u.flying ? !b.air : !b.ground) continue
        const d = Math.hypot(u.x - b.x, u.y - b.y)
        if (d <= b.range + 0.5 && d >= b.minRange && d < bd) { bd = d; tgt = u }
      }
      if (!tgt) { b.cd = 0; continue }
      b.cd = b.every
      tgt.hpNow -= b.dmg
      if (b.splash > 0) for (const u of alive) if (u !== tgt && u.hpNow > 0 && Math.hypot(u.x - tgt.x, u.y - tgt.y) <= b.splash) u.hpNow -= b.dmg
    }
    result.ticks = tick - t0
    if (targets.every(b => b.dead)) break
    if (!units.some(u => u.hpNow > 0) && next >= ev.length) break
  }
  result.destroyed = targets.filter(b => b.dead).length
  result.townHall = targets.some(b => b.th && b.dead)
  result.percent = result.destroyed === total ? 100 : Math.floor(result.destroyed * 100 / total)
  result.stars = (result.percent >= 50 ? 1 : 0) + (result.townHall ? 1 : 0) + (result.percent === 100 ? 1 : 0)
  return result
}

module.exports = { simulate }
