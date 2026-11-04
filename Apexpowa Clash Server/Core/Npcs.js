/**
 * Core/Npcs.js - the NPC villages (goblin maps). NPC id 17000000 + n is row n of Gamefiles/csv/npcs.csv; its LevelFile
 * column ("level/npc3.json") is the village that is sent to the game.
 *   Npcs.home(17000002)  -> the village JSON object of that NPC, or null when the id / file is unknown
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'Gamefiles')
let rows = null
const cache = {}

function load () {
  if (rows) return rows
  rows = []
  try {
    const lines = fs.readFileSync(path.join(ROOT, 'csv', 'npcs.csv'), 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter(l => l.length)
    const split = line => { const out = []; let c = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(c); c = '' } else c += ch } out.push(c); return out }
    const head = split(lines[0])
    const col = n => head.indexOf(n)
    for (const line of lines.slice(2)) {
      const cells = split(line)
      rows.push({ name: cells[col('Name')], map: cells[col('MapInstanceName')], levelFile: cells[col('LevelFile')], gold: Number(cells[col('Gold')]) || 0, elixir: Number(cells[col('Elixir')]) || 0 })
    }
  } catch (e) { console.log('[Npc] npcs.csv not loaded:', e.message) }
  return rows
}

/** config.json "Npc": { "Message": 24113 | 24133, "LevelFiles": true | false } (read every time, no restart needed). */
function options () {
  let o = {}
  try { o = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).Npc || {} } catch (e) {}
  // defaults: the NPC message (24133) the game opens in ATTACK mode, with the tapped NPC's own village
  return { mode: o.Mode === 'enemy' ? 'enemy' : 'npc', layout: o.Layout === 'B' ? 'B' : 'A', message: Number(o.Message) === 24113 ? 24113 : 24133, levelFiles: o.LevelFiles !== false, text: ['name', 'json', 'empty'].includes(o.Text) ? o.Text : 'none' }
}

/** The map instance name of an NPC ("npc3"), the text the NPC message carries before the village. */
function mapName (npcId) { const r = load()[Number(npcId) - 17000000]; return (r && r.map) || '' }

function home (npcId) {
  if (!options().levelFiles) return null // the tutorial goblin village, as before
  const row = load()[Number(npcId) - 17000000]
  if (!row || !row.levelFile) return null
  if (cache[row.levelFile]) return cache[row.levelFile]
  try { return (cache[row.levelFile] = JSON.parse(fs.readFileSync(path.join(ROOT, row.levelFile), 'utf8'))) } catch (e) {
    console.log(`[Npc] could not read ${row.levelFile}: ${e.message}`)
    return null
  }
}

/** An NPC dressed as an enemy player, so it can go out with the attack message (24107) that is known to work. */
function fakeEnemy (player, npcId) {
  const row = load()[Number(npcId) - 17000000] || {}
  const village = home(npcId) || null
  const e = Object.create(player)
  Object.assign(e, {
    highID: 0, lowID: 900000000 + (Number(npcId) - 17000000), name: 'Goblin', level: 1, league: 0, trophies: 0, highestTrophies: 0,
    gold: row.gold || 0, mana: row.elixir || 0, darkMana: 0, diamonds: 0,
    inClan: 0, clan: { ClanHighID: 0, ClanLowID: 1, ClanRole: 0 }, army: [], spells: [], heroes: 0,
    markModified () {}, save () {}
  })
  const fallback = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'level', 'tutorial_npc.json'), 'utf8')) } catch (err) { return null } })()
  const v = village || fallback
  if (v) e.village = JSON.stringify(v)
  return e
}

module.exports = { home, load, options, mapName, fakeEnemy }
