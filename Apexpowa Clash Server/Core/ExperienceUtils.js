/**
 * Experience / level handling.
 *
 * experience_levels.csv: row `Name` = level, `ExpPoints` = XP needed to LEAVE that
 * level (level 1 -> 2 needs 30, 2 -> 3 needs 50, ...). `player.xpPoints` is the XP
 * inside the current level (it carries over on level-up), which is what the client
 * shows on its XP bar, and `player.level` is 1-based.
 *
 * Nothing in ACS used to recompute `player.level`, so it stayed at 1 forever.
 */
const fs = require('fs')
const path = require('path')

let table = null // table[level - 1] = XP needed to leave `level`

function load () {
  if (table) return table
  table = []
  try {
    const file = path.join(__dirname, '..', 'Gamefiles', 'csv', 'experience_levels.csv')
    const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
    for (const line of lines.slice(2)) { // header + type rows
      const [level, exp] = line.replace(/"/g, '').split(',')
      const l = parseInt(level, 10)
      const e = parseInt(exp, 10)
      if (Number.isInteger(l) && Number.isInteger(e) && l >= 1) table[l - 1] = e
    }
  } catch (err) {
    console.error('[ExperienceUtils] unable to read experience_levels.csv:', err.message)
  }
  return table
}

const markModified = (player, field) => {
  if (player && typeof player.markModified === 'function') player.markModified(field)
}

/** XP gained for finishing a construction/upgrade that took `seconds` (floor of its square root). */
function xpForSeconds (seconds) {
  const s = Number(seconds)
  return Number.isFinite(s) && s > 0 ? Math.floor(Math.sqrt(s)) : 0
}

/**
 * Turns surplus xpPoints into levels. Also repairs accounts that were stuck at
 * level 1 with a pile of XP. Returns true when level or xpPoints changed.
 */
function normalizeExperience (player) {
  const levels = load()
  if (!player || levels.length === 0) return false

  let level = Math.max(1, Number(player.level) || 1)
  let xp = Math.max(0, Number(player.xpPoints) || 0)
  const maxLevel = levels.length

  while (level < maxLevel && levels[level - 1] > 0 && xp >= levels[level - 1]) {
    xp -= levels[level - 1]
    level++
  }
  if (level > maxLevel) level = maxLevel

  const changed = level !== player.level || xp !== player.xpPoints
  if (changed) {
    player.level = level
    player.xpPoints = xp
    markModified(player, 'level')
    markModified(player, 'xpPoints')
  }
  return changed
}

/** Adds XP and levels the player up. Caller is responsible for saving. */
function addExperience (player, amount) {
  const gained = Math.floor(Number(amount))
  if (!player || !Number.isFinite(gained) || gained <= 0) return false
  player.xpPoints = (Number(player.xpPoints) || 0) + gained
  markModified(player, 'xpPoints')
  normalizeExperience(player)
  return true
}

module.exports = { addExperience, normalizeExperience, xpForSeconds }
