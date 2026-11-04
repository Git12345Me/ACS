const fs = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'Database', 'mail.json')
const MAX_PER_PLAYER = 50

let data = null
let timer = null

function load () {
  if (data) return data
  data = { nextId: Math.floor(Date.now() / 1000), inbox: {} }
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8'))) } catch (e) { /* first run */ }
  return data
}

function save () {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(data)) } catch (e) { console.error('[Mail] save failed:', e.message) }
  }, 300)
  if (timer.unref) timer.unref()
}

const key = (h, l) => `${h}-${l}`

function add (high, low, entry) {
  const d = load()
  const e = Object.assign({}, entry, { id: d.nextId++ })
  const box = d.inbox[key(high, low)] = d.inbox[key(high, low)] || []
  box.unshift(e)
  if (box.length > MAX_PER_PLAYER) box.length = MAX_PER_PLAYER
  save()
  return e
}

const list = (high, low) => (load().inbox[key(high, low)] || []).slice()

function remove (high, low, id) {
  const d = load()
  const box = d.inbox[key(high, low)] || []
  const i = box.findIndex(e => e.id === id)
  if (i < 0) return false
  box.splice(i, 1)
  save()
  return true
}

module.exports = { add, list, remove, MAX_PER_PLAYER }
