/*
 * The player's own stream ("inbox"): clan mail and so on. Sent as 24411 (the whole list, at login) or 24412 (one new entry).
 *
 * The mails are NOT kept on the player record any more: the players table has no `inbox` column, so player.inbox was
 * silently dropped when the player was saved and the inbox came back empty after every login. They live in
 * Database/inbox.json, keyed "high-low", and are written a moment after every change.
 *
 * Wire layout, read from the disassembly of THIS client's libg.so (entry factory @0x125516, base decode @0x1253bc,
 * clan mail body @0x1251cc):
 *   24411:  INT count, then count entries          24412: one entry
 *   entry:  INT type, then the base, then the body of that type
 *   base:   LONG entry id, LONG sender avatar id, STRING sender name, INT sender level, INT league, INT age in seconds,
 *           BOOL, BOOL
 *   type 6 = CLAN MAIL body: STRING text, BOOL hasLong [LONG] (absent), LONG clan id, STRING clan name, INT clan badge
 */
const fs = require('fs')
const path = require('path')

const CLAN_MAIL = 6
const MAX_INBOX = 50
const MAX_TEXT = 256
const FILE = path.join(__dirname, '..', 'Database', 'inbox.json')

let store = null
let timer = null

function load () {
  if (store) return store
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) { store = {} }
  if (!store || typeof store !== 'object') store = {}
  return store
}

function save () {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.log('[Mail] could not save inbox.json: ' + e.message) }
  }, 500)
}

const keyOf = player => `${player.highID}-${player.lowID}`

/**
 * The "Server" bot mail every player sees. It is never stored (so nobody can delete it) and is built from config.json on
 * every inbox request, so editing the text there takes effect at the next login / inbox refresh, no restart needed.
 *   "ServerMail": { "Enabled": true, "Name": "Server", "Text": "...", "Level": 100 }
 */
function serverMail () {
  let c = {}
  try { c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).ServerMail || {} } catch (e) {}
  if (c.Enabled === false) return null
  const text = String(c.Text === undefined ? 'Welcome to the server!' : c.Text)
  if (!text) return null
  return {
    type: CLAN_MAIL, id: 2000000000, senderHighID: 0, senderLowID: 0, senderName: String(c.Name || 'Server'),
    senderLevel: Number(c.Level) || 100, senderLeague: 0, message: text.slice(0, 1000), clanHighID: 0, clanLowID: 0, clanName: '', clanBadge: 0,
    timestamp: Date.now()
  }
}

/** The player's mails, oldest first (the Server mail comes last = newest). */
function getInbox (player) {
  if (!player) return []
  const list = load()[keyOf(player)]
  const mails = Array.isArray(list) ? list.slice() : []
  const bot = serverMail()
  if (bot) mails.push(bot)
  return mails
}

function writeAvatarStreamEntry (stream, entry) {
  const age = Math.max(0, Math.floor((Date.now() - new Date(entry.timestamp || Date.now()).getTime()) / 1000))
  // 7 = Attack Log entry, 2 = Defense Log entry, anything else is a clan mail (older versions stored other numbers)
  const type = (entry.type === 7 || entry.type === 2) ? entry.type : CLAN_MAIL
  stream.writeInt(type)
  // base
  stream.writeLong(0, entry.id || 0)
  stream.writeLong(entry.senderHighID || 0, entry.senderLowID || 0)
  stream.writeString(entry.senderName || '')
  stream.writeInt(entry.senderLevel || 1)
  stream.writeInt(entry.senderLeague || 0)
  stream.writeInt(age)
  stream.writeBoolean(false)
  stream.writeBoolean(true)

  if (type === 7 || type === 2) {
    // attack / defense report (class @0x12eec0): STRING battle json, BOOL, INT, INT, INT, BOOL hasReplay [INT shard, LONG replay id]
    stream.writeString(entry.battleJson || '{}')
    stream.writeBoolean(false)
    stream.writeInt(entry.a || 0)
    stream.writeInt(entry.b || 0)
    stream.writeInt(entry.c || 0)
    if (entry.replayId) {
      stream.writeBoolean(true)
      stream.writeInt(0) // shard
      stream.writeLong(0, entry.replayId)
    } else {
      stream.writeBoolean(false)
    }
  }

  if (type === CLAN_MAIL) {
    // type 6 = clan mail (kind 6, decode @0x12e6c4): STRING text, BOOL hasLong [LONG], LONG clan id, STRING clan name, INT badge
    // (type 5 is "you have been kicked from clan <text>", type 4 another notice)
    stream.writeString(entry.message || '')
    stream.writeBoolean(false) // no extra long
    stream.writeLong(entry.clanHighID || 0, entry.clanLowID || 0)
    stream.writeString(entry.clanName || '')
    stream.writeInt(entry.clanBadge || 0)
  }
}

/** Adds an entry to a player's inbox (id = next free id there), keeping the newest MAX_INBOX. Returns the stored entry. */
function addToInbox (player, entry) {
  const all = load()
  const k = keyOf(player)
  const list = Array.isArray(all[k]) ? all[k] : []
  const id = list.reduce((max, e) => Math.max(max, (e && e.id) || 0), 0) + 1
  const copy = Object.assign({}, entry, { id })
  list.push(copy)
  all[k] = list.length > MAX_INBOX ? list.slice(-MAX_INBOX) : list
  save()
  return copy
}

module.exports = { CLAN_MAIL, MAX_TEXT, writeAvatarStreamEntry, addToInbox, getInbox }
