/**
 * Core/Replays.js - battle replays and the Attack / Defense Log of the inbox window.
 *
 * After every normal attack LogicEndCombatCommand calls recordBattle(). It
 *   1. stores the replay (Database/replays.json, newest MAX_REPLAYS kept; a readable copy of each replay is also
 *      written to Database/replays/<id>.json so the format can be checked),
 *   2. adds an "attack" entry (type 7) to the attacker's log and a "defense" entry (type 2) to the defender's,
 *      both carrying the replay id, and pushes it to whoever is online (24412).
 * The game asks for a replay with 14114 (INT shard, LONG id); HomeBattleReplayMessage answers 24114 with it.
 *
 * Replay JSON (keys read from libg.so, GameMode / replay saver @0x10e43c): level (defender village), defender,
 * attacker (avatar data), cmd (ARRAY of {"ct": command type, "c": {...}}), end_tick, prep_skip.
 * The command payload keys (t / x / y / d) and the avatar keys are the usual Supercell names but could not be
 * confirmed from the binary; if a replay does not start, send me Database/replays/<id>.json.
 */
const fs = require('fs')
const path = require('path')
let BattleLog = null
try {
  const m = require('./BattleLog') // the file may export the class directly or as a property
  BattleLog = typeof m === 'function' ? m : (m && (m.BattleLog || m.default)) || null
  if (typeof BattleLog !== 'function') BattleLog = null
} catch (e) { BattleLog = null }

const FILE = path.join(__dirname, '..', 'Database', 'replays.json')
const DIR = path.join(__dirname, '..', 'Database', 'replays')
const MAX_REPLAYS = 100

let store = null
let timer = null

function load () {
  if (store) return store
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) { store = null }
  if (!store || typeof store !== 'object') store = { next: 1, items: {} }
  if (!store.items) store.items = {}
  if (!store.next) store.next = 1
  return store
}

function save () {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.log('[Logic] replay: could not save replays.json: ' + e.message) }
  }, 500)
}

function getReplay (id) {
  return load().items[String(id)] || null
}

const num = v => Number(v) || 0

function avatarJSON (p, extra = {}) {
  let village = {}
  try { village = typeof p.village === 'string' ? JSON.parse(p.village) : (p.village || {}) } catch (e) {}
  return Object.assign({
    avatar_id_high: p.highID,
    avatar_id_low: p.lowID,
    name: p.name,
    xp_level: p.level || 1,
    xp_points: p.xp || 0,
    league_type: p.league || 0,
    score: p.trophies || 0,
    alliance_name: '',
    unit_upgrade_levels: village.unit_levels || {}
  }, extra)
}

function cleanVillage (village) {
  const v = JSON.parse(JSON.stringify(village || {}))
  for (const b of v.buildings || []) { if (b) { delete b.collectedAt; delete b.res_time; delete b.const_t } }
  delete v.alliance_units
  delete v.layouts
  return v
}

function countBy (events) {
  const m = new Map()
  for (const e of events) m.set(e.id, (m.get(e.id) || 0) + 1)
  return [...m.entries()]
}

const CMD_TYPES = { troop: 600, hero: 605, spell: 604 }

/**
 * ctx: { attacker, defender (player records), enemyVillage, events, endTick, sim, loot:{gold,mana,dark}, trophies, attackerBefore, defenderBefore, client }
 */
async function recordBattle (ctx) {
  const s = load()
  const id = s.next++
  const { attacker, defender, sim } = ctx
  const now = new Date().toISOString()

  const replay = {
    level: cleanVillage(ctx.enemyVillage),
    defender: avatarJSON(defender),
    attacker: avatarJSON(attacker),
    cmd: (ctx.events || []).filter(e => CMD_TYPES[e.type]).map(e => ({ ct: CMD_TYPES[e.type], c: { t: e.tick, x: e.x, y: e.y, d: e.id } })),
    end_tick: (ctx.endTick || 0) + 1, // LogicReplay.SubTick stores tick + 1
    timestamp: Math.floor(Date.now() / 1000)
  }
  // LogicReplay.RecordPreparationSkipTime: "prep_skip" only exists when the attacker skipped preparation (never on our server)
  s.items[String(id)] = { json: JSON.stringify(replay), at: now, attacker: [attacker.highID, attacker.lowID], defender: [defender.highID, defender.lowID] }
  const keys = Object.keys(s.items).map(Number).sort((a, b) => a - b)
  while (keys.length > MAX_REPLAYS) delete s.items[String(keys.shift())]
  save()
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(replay, null, 1)) } catch (e) {}

  // battle report JSON of the log entries
  let attackerJson; let defenderJson
  const slots = list => list.map(([id, count]) => [id, count])
  const plain = home => ({
    villageType: 0,
    loot: slots([[3000001, ctx.loot.gold], [3000002, ctx.loot.mana], [3000003, ctx.loot.dark]]),
    availableLoot: slots([[3000001, ctx.available.gold], [3000002, ctx.available.mana], [3000003, ctx.available.dark]]),
    units: slots(countBy((ctx.events || []).filter(e => e.type !== 'spell'))),
    spells: slots(countBy((ctx.events || []).filter(e => e.type === 'spell'))),
    levels: [],
    stats: {
      townhallDestroyed: !!sim.townHall, battleEnded: true, allianceUsed: false, destructionPercentage: sim.percent,
      battleTime: Math.round((sim.ticks || 0) / 20), originalAttackerScore: ctx.attackerBefore, attackerScore: attacker.trophies || 0,
      originalDefenderScore: ctx.defenderBefore, defenderScore: defender.trophies || 0, allianceName: '', attackerStars: sim.stars,
      attackerName: attacker.name, defenderName: defender.name, lootMultiplierByTownHallDiff: 100, homeID: home,
      deployedHousingSpace: 0, armyDeploymentPercentage: 0
    }
  })
  if (BattleLog) {
    try {
      const log = new BattleLog({ matchType: 0 })
      log.setAttackerHomeId([attacker.highID, attacker.lowID])
      log.setDefenderHomeId([defender.highID, defender.lowID])
      log.setAttackerName(attacker.name)
      log.setDefenderName(defender.name)
      log.setAttackerStars(sim.stars)
      log.setTownHallDestroyed(!!sim.townHall)
      log.setDestructionPercentage(sim.percent)
      log.setOriginalAttackerScore(ctx.attackerBefore)
      log.setOriginalDefenderScore(ctx.defenderBefore)
      log.setAttackerScore(attacker.trophies || 0)
      log.setDefenderScore(defender.trophies || 0)
      log.setAvailableLoot([{ id: 3000001, count: ctx.available.gold }, { id: 3000002, count: ctx.available.mana }, { id: 3000003, count: ctx.available.dark }])
      log.increaseStolenResourceCount(3000001, ctx.loot.gold)
      log.increaseStolenResourceCount(3000002, ctx.loot.mana)
      log.increaseStolenResourceCount(3000003, ctx.loot.dark)
      for (const e of ctx.events || []) {
        if (e.type === 'spell') log.incrementCastedSpells(e.id, 1)
        else log.incrementDeployedAttackerUnits(e.id, 1)
        if (e.level) log.setCombatItemLevel(e.id, e.level)
      }
      log.setBattleEnded(Math.round((ctx.sim.ticks || 0) / 20))
      attackerJson = JSON.stringify(log.generateAttackerJSON())
      defenderJson = JSON.stringify(log.generateDefenderJSON())
    } catch (e) { console.log('[Logic] replay: BattleLog failed (' + e.message + '), using the plain report') }
  }
  if (!attackerJson) {
    attackerJson = JSON.stringify(plain([defender.highID, defender.lowID]))
    defenderJson = JSON.stringify(plain([attacker.highID, attacker.lowID]))
  }

  // kept with the replay so it can be shared into the clan chat later (command 542)
  const item = s.items[String(id)]
  if (item) { item.attackerJson = attackerJson; item.defenderJson = defenderJson; item.attackerName = attacker.name; item.defenderName = defender.name; save() }

  // Make both reports match what the game itself writes (a sample is stored in libg.so): levels = [[id, level index]]
  // for every deployed unit / hero (the log shows index + 1, so 1 meant "no level was sent"), and stats.originalScore
  // = the trophies of this fight (the number next to the opponent's name; the game shows -1 when it is missing).
  const finalize = (jsonText, scoreAbs) => {
    try {
      const j = JSON.parse(jsonText)
      const lv = new Map()
      for (const e of ctx.events || []) if (e.type !== 'spell' && !lv.has(e.id)) lv.set(e.id, Number(e.level) || 0)
      j.levels = [...lv.entries()].map(([id, level]) => [id, level])
      j.stats = j.stats || {}
      j.stats.originalScore = scoreAbs
      return JSON.stringify(j)
    } catch (e) { return jsonText }
  }
  attackerJson = finalize(attackerJson, Math.abs((attacker.trophies || 0) - ctx.attackerBefore))
  defenderJson = finalize(defenderJson, Math.abs((attacker.trophies || 0) - ctx.attackerBefore))

  const { addToInbox } = require('./AvatarStream')
  const PlayerManager = require('./PlayerManager')
  const AvatarStreamEntryMessage = require('../Protocol/Messages/Server/AvatarStreamEntryMessage')
  const delta = (attacker.trophies || 0) - ctx.attackerBefore

  const deliver = async (target, entry) => {
    let conn = null
    for (const c of PlayerManager.getAll()) {
      const p = c.player
      if (p && p.highID === target.highID && p.lowID === target.lowID) { conn = c; break }
    }
    const stored = addToInbox(conn ? conn.player : target, entry)
    if (conn) { try { await new AvatarStreamEntryMessage(conn, stored).send() } catch (e) { console.log('[Logic] replay: could not push the log entry: ' + e.message) } }
  }
  // attacker's Attack Log (type 7): the other side is the defender
  await deliver(attacker, {
    type: 7, senderHighID: defender.highID, senderLowID: defender.lowID, senderName: defender.name, senderLevel: defender.level || 1,
    senderLeague: defender.league || 0, battleJson: attackerJson, replayId: id, a: delta, b: sim.stars, c: sim.percent, timestamp: now
  })
  // defender's Defense Log (type 2): the other side is the attacker
  await deliver(defender, {
    type: 2, senderHighID: attacker.highID, senderLowID: attacker.lowID, senderName: attacker.name, senderLevel: attacker.level || 1,
    senderLeague: attacker.league || 0, battleJson: defenderJson, replayId: id, a: -delta, b: sim.stars, c: sim.percent, timestamp: now
  })
  console.log(`[Logic] replay: saved as replay #${id} (${replay.cmd.length} command(s), end tick ${replay.end_tick}); log entries added for ${attacker.name} and ${defender.name}`)
  return id
}

module.exports = { recordBattle, getReplay }
