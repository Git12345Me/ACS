/**
 * Core/WarManager.js - clan wars for ACS (client 8.709.23 wire, see wars.md).
 *
 * Ported from the C# MessageHandler.Wars: search and matching by war weight, preparation and battle day
 * timers, scoring (stars, then destruction: WAR_TIE_BREAKING_MODE 1), war loot, exp and history.
 *
 * Differences from the C# server (ACS has no battle simulator and no per-resource War* storage):
 *  - A war attack result is NOT simulated. When the client ends a war battle, the result comes from
 *    client.warAttackResult (set by the /warhit helper or a future battle simulator), else from
 *    config.json -> War.DefaultAttack, else 0 stars / 0 %.
 *  - War loot is added straight to gold / elixir / dark elixir (no WarGold/WarElixir + command 563).
 *  - No war castle donations, replays, friendly wars or personal war cooldowns.
 *  - State lives in memory and is saved to Database/wars.json, so wars survive a restart.
 *
 * config.json -> "War": { "TeamSizes": [10,15,...], "PreparationMinutes": 1380, "BattleMinutes": 1440,
 *                          "ResultMinutes": 1440, "DefaultAttack": {"stars":0,"destruction":0}, "Exp": {...} }
 */
const fs = require('fs')
const path = require('path')
const PlayerManager = require('./PlayerManager')
const { DEFAULT_EXP } = require('./WarWriters')

let cfg = {}
try { cfg = require('../config.json').War || {} } catch (e) { cfg = {} }

const STATE = { NONE: 0, SEARCHING: 1, PREP: 4, BATTLE: 5, ENDED: 6 }
const ROLE_LEADER = 2
const ROLE_COLEADER = 4
const ClanPermissions = require('./ClanPermissions')
// Real war sizes only: 10v10 is the smallest war (there is no 1v1 ... 5v5 war in the game). Override with
// config.json -> War.TeamSizes, but nothing below War.MinTeamSize (default 10) is ever used.
const MIN_SIZE = Math.max(10, Math.trunc(Number(cfg.MinTeamSize ?? 10)) || 10) // never below 10: no 1v1 .. 5v5
const SIZES = (cfg.TeamSizes || [10, 15, 20, 25, 30, 40, 50]).map(Number).filter(s => s >= MIN_SIZE).sort((a, b) => a - b)
if (!SIZES.length) SIZES.push(10)
const SIM_ATTACKS = cfg.SimulateAttacks !== false // war attacks are replayed on the server (BattleSim); false = old fixed result
const PREP_MS = (cfg.PreparationMinutes ?? 1380) * 60000
const BATTLE_MS = (cfg.BattleMinutes ?? 1440) * 60000
const RESULT_MS = (cfg.ResultMinutes ?? 1440) * 60000
const ATTACKS_PER_MEMBER = 2 // ALLIANCE_WAR_NUM_ATTACKS
const LOOT_PERCENT = 3 // WAR_LOOT_PERCENTAGE
const FALLBACK_MS = 10 * 60000 // pair with the closest weight after searching this long
const LIVE_ATTACK_TIMEOUT_MS = 6 * 60000
const EXP = Object.assign({}, DEFAULT_EXP, cfg.Exp || {})
const DATA_FILE = path.join(__dirname, '..', 'Database', 'wars.json')

const FAIL = { NOT_IN_WAR: 3, INVALID_TARGET: 4, ALL_ATTACKS_USED: 5, TARGET_UNDER_ATTACK: 6, GENERIC: 8, SAME_TARGET: 13, ENDING: 14 }

let db = null
let timer = null
let saveTimer = null
let data = { nextWarId: 1, nextEventId: Math.floor(Date.now() / 10000), wars: [], archive: [], history: {}, payouts: {}, cooldowns: {}, prefs: {} }

// ------------------------------------------------------------------ persistence

function load () {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    data = Object.assign(data, loaded)
  } catch (e) { /* first run */ }
  // Wars of a size that no longer exists (old 1v1..5v5 test wars) would keep their clans stuck in "already in a war": drop them.
  const before = data.wars.length
  data.wars = data.wars.filter(w => SIZES.includes(w.size))
  data.archive = (data.archive || []).filter(w => SIZES.includes(w.size))
  if (data.wars.length !== before) { console.log(`[War] removed ${before - data.wars.length} war(s) of an unsupported size`); save() }
}

function save () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data)) } catch (e) { console.error('[War] save failed:', e.message) }
  }, 500)
  if (saveTimer.unref) saveTimer.unref()
}

function attach (database) {
  if (db) return
  db = database
  load()
  timer = setInterval(() => tick().catch(e => console.error('[War] tick failed:', e)), 5000)
  if (timer.unref) timer.unref()
}

// ------------------------------------------------------------------ helpers

const key = (h, l) => `${h}-${l}`
const playerKey = p => key(p.highID, p.lowID)
const clanKeyOf = p => (p && p.inClan && p.clan) ? key(p.clan.ClanHighID, p.clan.ClanLowID) : null

function clientsOf (clanKey) {
  const out = []
  for (const c of PlayerManager.getAll()) if (clanKeyOf(c.player) === clanKey) out.push(c)
  return out
}

function findClient (pKey) {
  for (const c of PlayerManager.getAll()) if (c.player && playerKey(c.player) === pKey) return c
  return null
}

function townHallOf (player) {
  try {
    const v = typeof player.village === 'string' ? JSON.parse(player.village) : player.village
    const th = (v.buildings || []).find(b => b && b.data === 1000001)
    return th ? (th.lvl || 0) : 0
  } catch (e) { return 0 }
}

const activeWar = clanKey => data.wars.find(w => w.A.key === clanKey || (w.B && w.B.key === clanKey))
const sideOf = (w, clanKey) => w.A.key === clanKey ? w.A : (w.B && w.B.key === clanKey ? w.B : null)
const otherSide = (w, clanKey) => w.A.key === clanKey ? w.B : w.A
const weightOf = side => side.members.reduce((s, m) => s + (m.townHall + 1) * 1000 + Math.min(m.score, 5000) / 5, 0)

function safeSend (msg) {
  return msg.send().catch(e => console.error('[War] send failed:', e.message))
}

async function broadcastWar (w) {
  const WarDataMessage = require('../Protocol/Messages/Server/WarDataMessage')
  for (const side of [w.A, w.B]) {
    if (!side) continue
    for (const c of clientsOf(side.key)) await safeSend(new WarDataMessage(c, w, side, EXP))
  }
}

async function broadcastMember (w, side, m) {
  const WarMemberMessage = require('../Protocol/Messages/Server/WarMemberMessage')
  for (const s of [w.A, w.B]) {
    if (!s) continue
    for (const c of clientsOf(s.key)) await safeSend(new WarMemberMessage(c, side, m))
  }
}

// ------------------------------------------------------------------ search and matching

/** Returns 0 on success, else a start-war failure code (StartWarFailedMessage). */
async function startSearch (client, excluded = [], minimumTeamSize = 0) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  if (!clanKey) return 5
  const existing = activeWar(clanKey)
  if (existing && existing.state !== STATE.ENDED) return 4
  if (existing) data.wars = data.wars.filter(w => w !== existing) // a finished war disappears once the clan searches again

  const clan = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID)
  if (!clan) return 3
  const actor = (clan.members || []).find(m => m.highID === p.highID && m.lowID === p.lowID)
  if (!actor || (actor.role !== ClanPermissions.ROLE.LEADER && actor.role !== ClanPermissions.ROLE.CO_LEADER)) return 1
  p.clan.ClanRole = actor.role
  const out = new Set(excluded.map(e => key(e[0], e[1])))
  const players = []
  for (const m of clan.members || []) {
    if (out.has(key(m.highID, m.lowID))) continue
    if (cooldownLeft(key(m.highID, m.lowID)) > 0 || data.prefs[key(m.highID, m.lowID)] === 0) continue // left a war clan / chose to stay out
    const pl = await db.getPlayerByID(m.highID, m.lowID)
    if (pl) players.push(pl)
  }
  const minSize = Math.max(MIN_SIZE, Math.trunc(Number(minimumTeamSize) || 0))
  const size = SIZES.filter(s => s <= players.length && s >= minSize).pop()
  if (!size) return 2

  players.sort((a, b) => townHallOf(b) - townHallOf(a) || (b.trophies || 0) - (a.trophies || 0))
  const side = {
    key: clanKey, highID: clan.highID, lowID: clan.lowID, name: clan.name, badge: clan.badge, level: clan.level || 1,
    expEarned: 0,
    members: players.slice(0, size).map((pl, i) => ({
      key: playerKey(pl), highID: pl.highID, lowID: pl.lowID, name: pl.name || '', townHall: townHallOf(pl), position: i,
      score: pl.trophies || 0, bestStars: 0, bestDestruction: 0, bestTime: 0, attacks: 0, defenses: 0,
      lootEarned: [0, 0, 0],
      lootAvailable: [pl.gold, pl.mana, pl.darkMana].map(v => Math.floor(Math.min(Number(v) || 0, 2e9) * LOOT_PERCENT / 100)),
      liveAttacker: null, liveAttackerPosition: 0, liveSince: 0, calledBy: null, bestEventId: null, attacked: [],
      castleCapacity: require('./ClanCastle').getClanCastle(pl).totalCapacity, donations: [], base: pl.village // snapshot: the base attackers fight
    }))
  }

  const other = findOpponent(side, size)
  let w
  if (other) {
    other.B = side
    other.state = STATE.PREP
    other.stateEnds = Date.now() + PREP_MS
    w = other
  } else {
    w = { id: data.nextWarId++, state: STATE.SEARCHING, stateEnds: Date.now(), searchStarted: Date.now(), type: 0, size, A: side, B: null, events: [], result: -1 }
    data.wars.push(w)
  }
  save()
  await broadcastWar(w)
  return 0
}

function findOpponent (side, size) {
  const mine = weightOf(side)
  let best = null
  let bestDiff = Infinity
  for (const w of data.wars) {
    if (w.state !== STATE.SEARCHING || w.B || w.size !== size || w.A.key === side.key) continue
    const diff = Math.abs(weightOf(w.A) - mine)
    if (diff <= Math.max(mine, 1) * 0.1 && diff < bestDiff) { best = w; bestDiff = diff }
  }
  return best
}

/** After FALLBACK_MS of searching, pair clans of the same size with the closest weight whatever the gap. */
function matchWaitingSearches (now) {
  const changed = []
  const waiting = data.wars.filter(w => w.state === STATE.SEARCHING && !w.B && now - w.searchStarted >= FALLBACK_MS)
  for (const w of waiting) {
    if (w.B) continue
    let best = null
    let bestDiff = Infinity
    for (const o of data.wars) {
      if (o === w || o.state !== STATE.SEARCHING || o.B || o.size !== w.size) continue
      const diff = Math.abs(weightOf(o.A) - weightOf(w.A))
      if (diff < bestDiff) { best = o; bestDiff = diff }
    }
    if (!best) continue
    w.B = best.A
    w.state = STATE.PREP
    w.stateEnds = now + PREP_MS
    data.wars = data.wars.filter(x => x !== best)
    changed.push(w)
  }
  return changed
}

async function cancelSearch (client) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  if (!clanKey) return false
  const clan = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID)
  const actor = clan && (clan.members || []).find(m => m.highID === p.highID && m.lowID === p.lowID)
  if (!actor || (actor.role !== ClanPermissions.ROLE.LEADER && actor.role !== ClanPermissions.ROLE.CO_LEADER)) return false
  p.clan.ClanRole = actor.role
  const w = activeWar(clanKey)
  if (!w || w.state !== STATE.SEARCHING) return false
  w.state = STATE.NONE
  await broadcastWar(w) // state 0: the client clears both entries
  data.wars = data.wars.filter(x => x !== w)
  save()
  return true
}

// ------------------------------------------------------------------ timers, scoring, end of war

async function tick () {
  const now = Date.now()
  const changed = matchWaitingSearches(now)
  for (const w of [...data.wars]) {
    if (!w.B) continue
    for (const s of [w.A, w.B]) for (const m of s.members) if (m.liveAttacker && now - m.liveSince > LIVE_ATTACK_TIMEOUT_MS) { m.liveAttacker = null; changed.push(w) }
    if (now < w.stateEnds) continue
    if (w.state === STATE.PREP) { w.state = STATE.BATTLE; w.stateEnds = now + BATTLE_MS } else if (w.state === STATE.BATTLE) { await endWar(w); w.stateEnds = now + RESULT_MS } else if (w.state === STATE.ENDED) {
      data.wars = data.wars.filter(x => x !== w)
      data.archive.push(w)
      if (data.archive.length > 50) data.archive.shift()
      continue
    } else continue
    changed.push(w)
  }
  if (changed.length) {
    save()
    for (const w of new Set(changed)) await broadcastWar(w)
  }
}

/** Client scoring (c66c0): more stars wins; on a tie, more total destruction. 1 win, 0 loss, 2 draw. */
function score (own, enemy) {
  const ours = enemy.members.reduce((s, m) => s + m.bestStars, 0)
  const theirs = own.members.reduce((s, m) => s + m.bestStars, 0)
  if (ours !== theirs) return ours > theirs ? 1 : 0
  const od = enemy.members.reduce((s, m) => s + m.bestDestruction, 0)
  const td = own.members.reduce((s, m) => s + m.bestDestruction, 0)
  return od === td ? 2 : (od > td ? 1 : 0)
}

/** Exp a clan earns (client c7eba): per enemy base with stars, plus star and win bonuses. */
function warExp (own, enemy, result) {
  let exp = 0
  let stars = 0
  for (const m of enemy.members) {
    stars += m.bestStars
    if (m.bestStars > 0) exp += EXP.byStrength ? Math.max(1, m.townHall) * EXP.multiplier : (EXP.positionExp[m.position] || 0)
  }
  const needed = 3 * enemy.members.length
  if (stars >= needed * EXP.pct1 / 100) exp += EXP.starsBonus1
  if (stars >= needed * EXP.pct2 / 100) exp += EXP.starsBonus2
  if (result === 1) exp += EXP.winBonus
  return exp
}

async function endWar (w) {
  w.state = STATE.ENDED
  w.result = score(w.A, w.B)
  for (const [own, enemy, res] of [[w.A, w.B, w.result], [w.B, w.A, w.result === 2 ? 2 : 1 - w.result]]) {
    own.expEarned = warExp(own, enemy, res)
    const bonus = res === 1 ? 600 : res === 2 ? 240 : 180 // win / draw / loss loot bonus %
    for (const m of own.members) {
      if (!m.lootEarned.some(x => x > 0)) continue
      await payout(m.key, m.lootEarned.map(x => Math.floor(x * bonus / 100)))
    }
    const row = {
      warId: w.id, clanId: [own.highID, own.lowID], clanName: own.name, clanBadge: own.badge, clanLevel: own.level,
      enemyId: [enemy.highID, enemy.lowID], enemyName: enemy.name, enemyBadge: enemy.badge, enemyLevel: enemy.level,
      clanStars: enemy.members.reduce((s, m) => s + m.bestStars, 0), enemyStars: own.members.reduce((s, m) => s + m.bestStars, 0),
      clanDestruction: enemy.members.reduce((s, m) => s + m.bestDestruction, 0),
      enemyDestruction: own.members.reduce((s, m) => s + m.bestDestruction, 0),
      size: w.size, result: res, ended: Date.now(), expEarned: own.expEarned
    }
    ;(data.history[own.key] = data.history[own.key] || []).unshift(row)
    data.history[own.key].length = Math.min(data.history[own.key].length, 30)
  }
}

// ------------------------------------------------------------------ war loot

async function payout (pKey, [gold, elixir, dark]) {
  const c = findClient(pKey)
  if (c) { await creditLoot(c.player, gold, elixir, dark); return }
  const q = data.payouts[pKey] = data.payouts[pKey] || { gold: 0, elixir: 0, dark: 0 }
  q.gold += gold; q.elixir += elixir; q.dark += dark
}

async function creditLoot (player, gold, elixir, dark) {
  player.gold = Number(player.gold || 0) + gold
  player.mana = Number(player.mana || 0) + elixir
  player.darkMana = Number(player.darkMana || 0) + dark
  for (const f of ['gold', 'mana', 'darkMana']) if (typeof player.markModified === 'function') player.markModified(f)
  if (typeof player.save === 'function') await player.save()
}

/** Pays war loot collected while the player was offline. Call at login before the home data is sent. */
async function applyPayouts (player) {
  const k = playerKey(player)
  const q = data.payouts[k]
  if (!q) return
  delete data.payouts[k]
  save()
  await creditLoot(player, q.gold, q.elixir, q.dark)
}

// ------------------------------------------------------------------ attacks

/**
 * Validates a 15001. Returns { fail } or { war, own, target } and marks the target as being attacked.
 * The caller sends the enemy home and 24326 (AttackWarBaseMessage).
 */
async function beginAttack (client, targetKey) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  const w = clanKey ? activeWar(clanKey) : null
  const own = w && sideOf(w, clanKey)
  const enemy = w && otherSide(w, clanKey)
  const me = own && own.members.find(m => m.key === playerKey(p))
  const target = enemy && enemy.members.find(m => m.key === targetKey)
  let fail = 0
  if (!w || !own || !enemy) fail = FAIL.NOT_IN_WAR
  else if (w.state !== STATE.BATTLE) fail = w.state === STATE.ENDED ? FAIL.ENDING : FAIL.GENERIC
  else if (!target) fail = FAIL.NOT_IN_WAR
  else if (!me) fail = FAIL.INVALID_TARGET
  else if (me.attacks >= ATTACKS_PER_MEMBER) fail = FAIL.ALL_ATTACKS_USED
  else if (target.liveAttacker) fail = FAIL.TARGET_UNDER_ATTACK
  else if (me.attacked.includes(targetKey)) fail = FAIL.SAME_TARGET
  else if (w.stateEnds - Date.now() < 30000) fail = FAIL.ENDING
  if (fail) return { fail }

  target.liveAttacker = me.name
  target.liveAttackerPosition = me.position
  target.liveSince = Date.now()
  client.warAttack = { warId: w.id, targetKey, started: Date.now() }
  save()
  await broadcastMember(w, enemy, target)
  return { war: w, own, enemy, me, target }
}

/** Undo beginAttack when the enemy home could not be sent. */
async function abortAttack (client) {
  const a = client.warAttack
  client.warAttack = null
  if (!a) return
  const w = data.wars.find(x => x.id === a.warId)
  if (!w || !w.B) return
  const enemy = w.A.members.some(m => m.key === a.targetKey) ? w.A : w.B
  const target = enemy.members.find(m => m.key === a.targetKey)
  if (target) { target.liveAttacker = null; await broadcastMember(w, enemy, target) }
  save()
}

/** Replays the attacker's placements on the defender's war base snapshot: { stars, destruction } or null when it cannot run. */
function simulateAttack (client, base, endTick) {
  try {
    const BattleSim = require('./BattleSim')
    const parse = v => typeof v === 'string' ? JSON.parse(v) : (v || {})
    const mine = parse(client.player.village)
    const lvOf = id => Number(mine.unit_levels?.[id % 1000000]) || 0
    const heroLv = id => { const altar = (mine.buildings || []).find(b => b && b.data === (id === 28000000 ? 1000022 : 1000025)); return altar ? (altar.lvl || 0) : 0 }
    const sim = BattleSim.simulate(parse(base), client.battleEvents || [], endTick || 0, { unit: lvOf, hero: heroLv }, { ticksPerSecond: 20 })
    console.log(`[War] simulated attack: ${sim.percent}% (${sim.destroyed}/${sim.total}), ${sim.stars} star(s), town hall ${sim.townHall ? 'destroyed' : 'standing'}`)
    return { stars: sim.stars, destruction: sim.percent }
  } catch (e) {
    console.error('[War] attack simulation failed:', e.message)
    return null
  }
}

/** Called when the client ends a war battle. Records stars, loot and the attack event, then tells both clans (25004). */
async function finishAttack (client, endTick = 0) {
  const a = client.warAttack
  if (!a) return false
  // No troop deployed = the attack was only opened and left again: it is not used up and the base is freed.
  if (!client.attackDeployed && !client.warAttackResult) {
    client.battleEvents = []
    await abortAttack(client)
    return false
  }
  client.warAttack = null
  const w = data.wars.find(x => x.id === a.warId)
  if (!w || !w.B) return false
  const enemy = w.A.members.some(m => m.key === a.targetKey) ? w.A : w.B
  const own = enemy === w.A ? w.B : w.A
  const target = enemy.members.find(m => m.key === a.targetKey)
  const me = own.members.find(m => m.key === playerKey(client.player))
  if (!target || !me) return false

  // Result: an explicit override (/warhit), else the server simulation of the real placements, else the config default.
  const r = client.warAttackResult || (SIM_ATTACKS && simulateAttack(client, target.base, endTick)) || cfg.DefaultAttack || { stars: 0, destruction: 0 }
  client.warAttackResult = null
  client.battleEvents = []
  client.attackDeployed = false
  const stars = Math.max(0, Math.min(3, r.stars | 0))
  const destruction = Math.max(0, Math.min(100, r.destruction | 0))
  const duration = Math.round((Date.now() - a.started) / 1000)
  const newStars = Math.max(0, stars - target.bestStars)
  const ev = {
    id: data.nextEventId++, time: Date.now(), attackerClan: [own.highID, own.lowID], attackerId: [me.highID, me.lowID],
    attackerName: me.name, defenderClan: [enemy.highID, enemy.lowID], defenderId: [target.highID, target.lowID],
    defenderName: target.name, stars, newStars, destruction, duration
  }
  w.events.push(ev)
  me.attacks++
  me.attacked.push(target.key)
  for (let i = 0; i < 3; i++) me.lootEarned[i] += Math.floor(target.lootAvailable[i] * newStars / 3) // a third of the base per new star
  target.defenses++
  target.liveAttacker = null
  if (stars > target.bestStars || (stars === target.bestStars && destruction > target.bestDestruction)) {
    target.bestStars = stars; target.bestDestruction = destruction; target.bestTime = duration; target.bestEventId = ev.id
  }
  save()

  const WarAttackResultMessage = require('../Protocol/Messages/Server/WarAttackResultMessage')
  for (const s of [w.A, w.B]) {
    for (const c of clientsOf(s.key)) await safeSend(new WarAttackResultMessage(c, { ownClan: own, enemyClan: enemy, attacker: me, defender: target, event: ev }))
  }
  return true
}

async function callTarget (client, targetKey) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  const w = clanKey && activeWar(clanKey)
  const enemy = w && otherSide(w, clanKey)
  const target = enemy && enemy.members.find(m => m.key === targetKey)
  if (!target) return
  target.calledBy = [p.highID, p.lowID]
  save()
  await broadcastMember(w, enemy, target)
}

// ------------------------------------------------------------------ queries

function warById (id) {
  return data.wars.find(w => w.id === id && w.B) || data.archive.find(w => w.id === id)
}

function historyOf (clanKey) {
  return data.history[clanKey] || []
}

/** After login: the clan's current war, if any; otherwise an empty "no war" state. */
async function sendWarTo (client) {
  const clanKey = clanKeyOf(client.player)
  if (!clanKey) return
  const WarDataMessage = require('../Protocol/Messages/Server/WarDataMessage')
  const w = activeWar(clanKey)
  if (w) return safeSend(new WarDataMessage(client, w, sideOf(w, clanKey), EXP))

  // No war: the client keeps answering "Clan wars are still loading, please try again" when the war button is tapped until
  // it has received what it is waiting for at login. Which message / value that is has not been confirmed, so what is sent can be
  // changed WITHOUT restarting through Gamefiles/war_empty_state.json (read on every login), for example:
  //   { "sendState": true, "state": 0, "history": true, "error": false }
  //   state    - war state number written in the empty 24335 (try 0, 1, 2, 3, 4, 5, 6)
  //   sendState- send the empty 24335 war state
  //   history  - also send an empty war log (24338)
  //   error    - also send 24337 WarDataError (code 0)
  //   members  - fill the state with the real clan roster (needed for states 1, 4, 5, 6 to look like a real war)
  let opt = { sendState: false, state: STATE.NONE, history: false, error: false, members: false }
  try { opt = { ...opt, ...JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'Gamefiles', 'war_empty_state.json'), 'utf8')) } } catch (e) {}
  try {
    const p = client.player
    const clan = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID)
    if (!clan) return
    let own = { key: clanKey, highID: clan.highID, lowID: clan.lowID, name: clan.name || '', badge: clan.badge || 0, level: clan.level || 1, expEarned: 0, members: [] }
    if (opt.members) own = (await previewSide(client)) || own // the real clan roster instead of an empty one
    if (opt.sendState) {
      const none = { id: 0, state: Number(opt.state) || 0, stateEnds: Date.now(), type: 0, size: 0, A: own, B: null, events: [], result: -1 }
      await safeSend(new WarDataMessage(client, none, own, EXP))
    }
    if (opt.history) {
      const AllianceWarHistoryMessage = require('../Protocol/Messages/Server/AllianceWarHistoryMessage')
      await safeSend(new AllianceWarHistoryMessage(client, [], [clan.highID, clan.lowID]))
    }
    if (opt.error) {
      const WarDataErrorMessage = require('../Protocol/Messages/Server/WarDataErrorMessage')
      await safeSend(new WarDataErrorMessage(client, 0))
    }
    if (opt.sendState || opt.history || opt.error) client.log(`[War] sent the empty war messages to ${p.name}: ${JSON.stringify(opt)}`)
  } catch (e) {
    console.error('[War] could not send the empty war messages:', e.message)
  }
}

/** The clan's roster as a war side (same data startSearch builds), without creating a war: for the preview state sent at login. */
async function previewSide (client) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  const clan = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID)
  if (!clan) return null
  const players = []
  for (const m of clan.members || []) {
    const pl = await db.getPlayerByID(m.highID, m.lowID)
    if (pl) players.push(pl)
  }
  players.sort((a, b) => townHallOf(b) - townHallOf(a) || (b.trophies || 0) - (a.trophies || 0))
  return {
    key: clanKey, highID: clan.highID, lowID: clan.lowID, name: clan.name, badge: clan.badge, level: clan.level || 1, expEarned: 0,
    members: players.map((pl, i) => ({
      key: playerKey(pl), highID: pl.highID, lowID: pl.lowID, name: pl.name || '', townHall: townHallOf(pl), position: i,
      score: pl.trophies || 0, bestStars: 0, bestDestruction: 0, bestTime: 0, attacks: 0, defenses: 0, lootEarned: [0, 0, 0],
      lootAvailable: [0, 0, 0], liveAttacker: null, liveAttackerPosition: 0, liveSince: 0, calledBy: null, bestEventId: null, attacked: [],
      castleCapacity: 0, base: ''
    }))
  }
}

/** A clan's war entry for 24329: its side of the current war, or an empty entry (no members) when it has no war. null = clan unknown. */
async function entryFor (high, low) {
  const k = key(high, low)
  const w = activeWar(k)
  const side = w && sideOf(w, k)
  if (side) return side
  const clan = await db.getClanByID(high, low)
  if (!clan) return null
  return { key: k, highID: clan.highID, lowID: clan.lowID, name: clan.name || '', badge: clan.badge || 0, level: clan.level || 1, expEarned: 0, members: [] }
}

// ------------------------------------------------------------------ war extras (wars.md section 12)

const CSVManager = require('./CSVManager')

/** Seconds left of the personal war cooldown (a player who left a clan mid-war cannot join another war). */
function cooldownLeft (pKey) {
  const ends = data.cooldowns[pKey]
  return ends && ends > Date.now() ? Math.ceil((ends - Date.now()) / 1000) : 0
}

/** Called when a player leaves or is kicked from a clan. */
function onLeftClan (player, clanKey) {
  const w = activeWar(clanKey)
  if (!w || w.state === STATE.ENDED) return
  const side = sideOf(w, clanKey)
  const pKey = playerKey(player)
  const inRoster = side && side.members.some(m => m.key === pKey)
  if (!inRoster && w.state !== STATE.SEARCHING) return
  const ends = w.state === STATE.PREP ? w.stateEnds + BATTLE_MS : w.state === STATE.BATTLE ? w.stateEnds : Date.now() + PREP_MS + BATTLE_MS
  data.cooldowns[pKey] = ends
  save()
}

/** Command 570: war preference, 1 in, 0 out. Players who are out are left out of the next roster. */
function setPreference (player, pref) {
  data.prefs[playerKey(player)] = pref ? 1 : 0
  save()
}

/** 15000: finds the war base of a player of the viewer's own war. Returns { w, side, member } or null. */
function findWarBase (client, targetKey) {
  const clanKey = clanKeyOf(client.player)
  const w = clanKey ? activeWar(clanKey) : null
  if (!w || !w.B || w.state < STATE.PREP) return null
  for (const side of [w.A, w.B]) {
    const member = side.members.find(m => m.key === targetKey)
    if (member) return { w, side, member }
  }
  return null
}

function housingOf (unitId) {
  const row = CSVManager.getLevelData('characters', unitId, 0)
  return row ? Number(row.HousingSpace) || 1 : 1
}

const usedCastle = member => (member.donations || []).reduce((sum, d) => sum + d.units.reduce((a, u) => a + u.count * housingOf(u.data), 0), 0)

/** 15002: a clan mate gives one troop to a war Clan Castle (preparation day only, own clan only). */
async function donateUnit (client, unitId, targetKey) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  const w = clanKey ? activeWar(clanKey) : null
  const own = w && sideOf(w, clanKey)
  const target = own && own.members.find(m => m.key === targetKey)
  if (!w || !own || !target || w.state !== STATE.PREP) return 'not in preparation day / target not in the own war roster'
  if (Math.floor(unitId / 1000000) !== 4) return 'only troops can be donated'
  const housing = housingOf(unitId)
  if (!target.castleCapacity || usedCastle(target) + housing > target.castleCapacity) return `castle full (${usedCastle(target)}+${housing}/${target.castleCapacity})`
  const slot = (p.army || []).find(u => Number(u.unitID) === unitId && Number(u.count) > 0)
  if (!slot) return 'the donor has no such troop'
  slot.count = Number(slot.count) - 1
  p.army = p.army.filter(u => Number(u.count) > 0)
  if (typeof p.markModified === 'function') p.markModified('army')
  if (typeof p.save === 'function') await p.save()
  if (!target.donations) target.donations = []
  let d = target.donations.find(x => x.donor[0] === p.highID && x.donor[1] === p.lowID)
  if (!d) { d = { donor: [p.highID, p.lowID], units: [] }; target.donations.push(d) }
  const u = d.units.find(x => x.data === unitId)
  if (u) u.count++
  else d.units.push({ data: unitId, count: 1 })
  save()
  await broadcastMember(w, own, target)
  return null
}

/** 15003: the donor takes back the latest war donation of that unit (the unit is lost, like the official popup says). */
async function removeDonation (client, unitId) {
  const p = client.player
  const clanKey = clanKeyOf(p)
  const w = clanKey ? activeWar(clanKey) : null
  const own = w && sideOf(w, clanKey)
  if (!w || !own || w.state !== STATE.PREP) return false
  for (const m of own.members) {
    const d = (m.donations || []).find(x => x.donor[0] === p.highID && x.donor[1] === p.lowID && x.units.some(u => u.data === unitId))
    if (!d) continue
    const u = d.units.find(x => x.data === unitId)
    if (--u.count <= 0) d.units = d.units.filter(x => x !== u)
    m.donations = m.donations.filter(x => x.units.length)
    save()
    await broadcastMember(w, own, m)
    return true
  }
  return false
}

module.exports = {
  STATE, FAIL, EXP, entryFor, previewSide,
  attach, startSearch, cancelSearch, beginAttack, abortAttack, finishAttack, callTarget, applyPayouts, sendWarTo,
  warById, historyOf, sideOf, tick, score, warExp,
  cooldownLeft, onLeftClan, setPreference, findWarBase, donateUnit, removeDonation,
  _data: () => data
}
