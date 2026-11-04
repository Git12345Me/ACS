/*
 * Reads Gamefiles/csv/achievements.csv.
 *
 * The client numbers achievements by row, skipping the blank separator rows:
 *   ID = 23000000 + index of the row that has a Name
 * (e.g. 23000003 = com.supercell.magic.npcstars0, the "10 NPC stars" award).
 */
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'Gamefiles', 'csv', 'achievements.csv')
const CLASS_ID = 23000000

function parseLine (line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

function load () {
  const byId = new Map()
  let lines
  try {
    lines = fs.readFileSync(FILE, 'utf8').replace(/\r/g, '').split('\n')
  } catch (err) {
    console.log('[AchievementData] could not read achievements.csv:', err.message)
    return byId
  }
  if (lines.length < 3) return byId

  const headers = parseLine(lines[0])
  let index = 0
  for (let i = 2; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    if (!cells[0]) continue // blank separator row, not counted by the client
    const row = {}
    headers.forEach((h, c) => { row[h] = cells[c] })
    const id = CLASS_ID + index++
    byId.set(id, {
      id,
      name: row.Name,
      level: parseInt(row.Level, 10) || 0,
      action: row.Action,
      actionCount: parseInt(row.ActionCount, 10) || 0,
      actionData: row.ActionData || '',
      expReward: parseInt(row.ExpReward, 10) || 0,
      diamondReward: parseInt(row.DiamondReward, 10) || 0
    })
  }
  return byId
}

const table = load()

module.exports = {
  CLASS_ID,
  get: id => table.get(Number(id)) || null,
  all: () => Array.from(table.values()),
  size: table.size
}
