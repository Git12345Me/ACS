// Reads true/false (and number) switches from Gamefiles/clan_event_numbers.json. The file is re-read when it changes,
// so a switch can be flipped without restarting the server.
const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'Gamefiles', 'clan_event_numbers.json')
let mtime = 0
let data = {}

function get (name, fallback) {
  try {
    const m = fs.statSync(FILE).mtimeMs
    if (m !== mtime) { mtime = m; data = JSON.parse(fs.readFileSync(FILE, 'utf8')) }
  } catch (e) { /* no file: use the fallback */ }
  return typeof data[name] === typeof fallback ? data[name] : fallback
}

module.exports = { get }
