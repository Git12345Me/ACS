const fs = require('fs')
const path = require('path')

const CSV_DIR = path.join(__dirname, '..', 'Gamefiles', 'csv')


function parseCsvLine (line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

function coerce (raw, type) {
  if (raw === undefined || raw === '') return raw === undefined ? undefined : ''
  if (type === 'int') {
    const n = parseInt(raw, 10)
    return Number.isNaN(n) ? 0 : n
  }
  if (type === 'boolean' || type === 'Boolean') {
    return raw.toLowerCase() === 'true'
  }
  return raw
}

function loadTable (fileName) {
  const filePath = path.join(CSV_DIR, fileName)
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '')
  const lines = raw.split('\n').filter(l => l.length > 0)
  if (lines.length < 3) return []

  const headers = parseCsvLine(lines[0])
  const types = parseCsvLine(lines[1])
  const objects = []
  let current = null
  let previousRow = null

  for (let li = 2; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li])
    const nameCell = cells[0]

    if (nameCell && nameCell.length > 0) {
      current = []
      objects.push(current)
      previousRow = null
    }
    if (!current) continue // stray rows before any named object

    const levelRow = {}
    headers.forEach((h, i) => {
      const rawVal = cells[i]
      if ((rawVal === undefined || rawVal === '') && previousRow) {
        levelRow[h] = previousRow[h]
      } else {
        levelRow[h] = coerce(rawVal, types[i])
      }
    })
    current.push(levelRow)
    previousRow = levelRow
  }
  return objects
}

const RESOURCE_FIELD_BY_NAME = {
  Gold: 'gold',
  Elixir: 'mana',
  DarkElixir: 'darkMana',
  Diamonds: 'diamonds'
}

// Tables loaded eagerly at startup. Add more names here as later phases of
// the port need them (characters, spells, npcs, ...) -- loadTable() is
// wrapped in try/catch below so a missing/renamed file can't crash boot.
const TABLE_FILES = [
  'buildings', 'traps', 'decos', 'obstacles', 'resources', 'townhall_levels', 'characters'
]

class CSVManager {
  constructor () {
    this.tables = {}
    for (const name of TABLE_FILES) {
      try {
        this.tables[name] = loadTable(`${name}.csv`)
      } catch (err) {
        console.log(`[CSVManager] Failed to load ${name}.csv:`, err.message)
        this.tables[name] = []
      }
    }
  }

  /** The full level-by-level row group for a placed object, e.g. all levels of the exact building the player owns. */
  getRowGroup (tableName, globalID) {
    const table = this.tables[tableName]
    if (!table || !table.length) return null
    const instanceID = globalID % 1000000
    return table[instanceID] || null
  }

  /** A single level's data row. `level` is 0-indexed (0 = level 1), and is clamped to the data actually present. */
  getLevelData (tableName, globalID, level) {
    const group = this.getRowGroup(tableName, globalID)
    if (!group || !group.length) return null
    const idx = Math.max(0, Math.min(level, group.length - 1))
    return group[idx]
  }

  /** Highest valid 0-indexed level for this object, or -1 if the object/table isn't known. */
  getMaxLevelIndex (tableName, globalID) {
    const group = this.getRowGroup(tableName, globalID)
    return group ? group.length - 1 : -1
  }

  /** Maps a CSV "BuildResource" string (e.g. "Elixir") to the player-row column that holds it (e.g. "mana"). */
  resourceField (resourceName) {
    return RESOURCE_FIELD_BY_NAME[resourceName] || null
  }

  buildTimeSeconds (row) {
    if (!row) return 0
    return (row.BuildTimeD || 0) * 86400 + (row.BuildTimeH || 0) * 3600 + (row.BuildTimeM || 0) * 60
  }
}

// Singleton, matching how Utilities/index.js and Utilities/Utils.js are
// consumed elsewhere in ACS (require(...) returns one shared instance).
module.exports = new CSVManager()
