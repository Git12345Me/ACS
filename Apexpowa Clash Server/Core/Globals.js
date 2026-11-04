/**
 * Core/Globals.js - values from Gamefiles/csv/globals.csv (the game's own constants), read once and cached.
 *   Globals.number('CLAN_MAIL_COOLDOWN', 43200)   -> the NumberValue, or the fallback when the row does not exist
 *   Globals.array('LOOT_MULTIPLIER_BY_TH_DIFF', [100])   -> the NumberArray column (the following rows with a blank name)
 */
const fs = require('fs')
const path = require('path')

let table = null
function load () {
  if (table) return table
  table = {}
  try {
    const rows = fs.readFileSync(path.join(__dirname, '..', 'Gamefiles', 'csv', 'globals.csv'), 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split('\n')
    let cur = null
    for (const line of rows.slice(2)) {
      const cells = []; let c = ''; let q = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++ } else q = false } else c += ch } else if (ch === '"') q = true
        else if (ch === ',') { cells.push(c); c = '' } else c += ch
      }
      cells.push(c)
      if (cells[0]) { cur = table[cells[0]] = { number: undefined, array: [] } }
      if (!cur) continue
      if (cells[1] !== undefined && cells[1] !== '' && cur.number === undefined) cur.number = Number(cells[1])
      if (cells[4] !== undefined && cells[4] !== '') cur.array.push(Number(cells[4]))
    }
  } catch (e) { console.log('[Globals] globals.csv not loaded:', e.message) }
  return table
}

// Values of the game's own globals.csv that the server's copy of the file may not have (taken from the client's globals.csv).
// A row in Gamefiles/csv/globals.csv always wins over these.
const BUILT_IN = {
  CLAN_MAIL_COOLDOWN: 43200,
  MAX_ALLIANCE_MAIL_LENGTH: 256,
  ALLIANCE_TROOP_REQUEST_COOLDOWN: 1200,
  MAX_TROOP_DONATION_COUNT: 5,
  ALLIANCE_CREATE_COST: 40000,
  ELDER_KICK_COOLDOWN: 1200,
  REPLAY_SHARE_COOLDOWN: 1800,
  ATTACK_LENGTH_SEC: 180,
  ATTACK_PREPARATION_LENGTH_SEC: 30,
  SCORE_MULTIPLIER_ON_ATTACK_LOSE: 2,
  RESOURCE_PRODUCTION_LOOT_PERCENTAGE_DARK_ELIXIR: 75,
  LOOT_MULTIPLIER_BY_TH_DIFF: [100, 100, 100, 100, 100, 90, 50, 25, 5]
}

const number = (name, fallback) => {
  const r = load()[name]
  if (r && Number.isFinite(r.number)) return r.number
  return typeof BUILT_IN[name] === 'number' ? BUILT_IN[name] : fallback
}
const array = (name, fallback) => {
  const r = load()[name]
  if (r && r.array.length) return r.array
  return Array.isArray(BUILT_IN[name]) ? BUILT_IN[name] : fallback
}

module.exports = { number, array }
