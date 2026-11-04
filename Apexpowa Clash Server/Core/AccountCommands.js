// Main accounts through global chat: a username and password that owns several villages. Any chat line starting
// with "/" is a command: it is never shown to other players, and only the sender sees the answers.
// Switching sends 20132 UnlockAccountOk with the other village's id and token; the game stores them and reloads.
const GlobalChatLineMessage = require('../Protocol/Messages/Server/GlobalChatLineMessage')
const UnlockAccountOkMessage = require('../Protocol/Messages/Server/UnlockAccountOkMessage')
const PlayerManager = require('./PlayerManager')
const RedeemCodes = require('./RedeemCodes')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MIN_PASSWORD = 6
const MAX_PASSWORD = 64
const MAX_LOGIN_FAILURES = 5
const FAILURE_WINDOW_MS = 10 * 60000
const SERVER_NAME = 'Server'

const loginFailures = new Map() // "high:low" -> { count, since }

const HELP = [
  'Commands (only you can see them):',
  '/id  show this village id',
  '/register <password>  put a password on this village',
  '/login <id> <password>  play the village with that id',
  '/password <old> <new>  change the password of this village',
  '/logout  leave this village (a new empty one starts here)',
  '/redeem <code>  redeem a code for gems',
  '/status  server status',
  '/base  list the bases you can load',
  '/base <name>  load a base layout, e.g. /base townhall8',
  '/base undo  bring your old village back',
  '/visit <number>  visit a village by its # number',
  '/help  this list'
]

const keyOf = p => `${p.highID}:${p.lowID}`

async function say (client, ...lines) {
  const p = client.player
  for (const message of lines) {
    await new GlobalChatLineMessage(client, {
      message, name: SERVER_NAME, level: 1, highID: p.highID, lowID: p.lowID, inClan: false
    }).send()
  }
}

const passwordProblem = pw => (pw.length < MIN_PASSWORD || pw.length > MAX_PASSWORD) ? `Passwords need ${MIN_PASSWORD} to ${MAX_PASSWORD} characters, with no spaces.` : null

/** Village ids are typed as 5, #5 or 0-5. */
function parseVillageId (text) {
  const m = /^#?(?:(\d+)-)?(\d+)$/.exec(String(text || ''))
  return m ? { highID: Number(m[1] || 0), lowID: Number(m[2]) } : null
}

/** /register <password>: the village id is the username, so only a password is needed. */
async function register (client, args) {
  const db = client.mongoose
  const p = client.player
  if (args.length !== 1) return say(client, 'Usage: /register <password>   (your village id is your username, see /id)')
  const problem = passwordProblem(args[0])
  if (problem) return say(client, problem)
  if (await db.hasVillagePassword(p.highID, p.lowID)) return say(client, 'This village already has a password. Use /password <old> <new> to change it.')
  await db.setVillagePassword(p.highID, p.lowID, args[0])
  client.log(`[Account] password set for village ${keyOf(p)}`)
  await say(client, `Password set. To play this village from another phone type /login ${p.lowID} <password>.`)
}

/** /login <id> <password>: loads that village on this phone. */
async function login (client, args) {
  const db = client.mongoose
  const p = client.player
  if (args.length !== 2) return say(client, 'Usage: /login <village id> <password>   (/id shows the id of a village)')
  const target = parseVillageId(args[0])
  if (!target) return say(client, 'The village id is a number, like 12 or #12.')

  const now = Date.now()
  const f = loginFailures.get(keyOf(p))
  if (f && now - f.since < FAILURE_WINDOW_MS && f.count >= MAX_LOGIN_FAILURES) {
    return say(client, `Too many wrong passwords. Try again in ${Math.ceil((FAILURE_WINDOW_MS - (now - f.since)) / 60000)} min.`)
  }
  const village = await db.getPlayerByID(target.highID, target.lowID)
  const ok = village && await db.checkVillagePassword(target.highID, target.lowID, args[1])
  if (!ok) {
    const old = loginFailures.get(keyOf(p))
    loginFailures.set(keyOf(p), old && now - old.since < FAILURE_WINDOW_MS ? { count: old.count + 1, since: old.since } : { count: 1, since: now })
    client.log('[Account] village login failed')
    return say(client, 'Wrong village id or password.') // the same answer whether the village exists or has no password
  }
  loginFailures.delete(keyOf(p))
  if (village.highID === p.highID && village.lowID === p.lowID) return say(client, 'You are already playing this village.')
  await switchTo(client, village)
}

/** /password <old> <new> for this village. */
async function changePassword (client, args) {
  const db = client.mongoose
  const p = client.player
  if (args.length !== 2) return say(client, 'Usage: /password <old password> <new password>')
  if (!(await db.hasVillagePassword(p.highID, p.lowID))) return say(client, 'This village has no password yet. Use /register <password>.')
  if (!(await db.checkVillagePassword(p.highID, p.lowID, args[0]))) return say(client, 'The old password is wrong.')
  const problem = passwordProblem(args[1])
  if (problem) return say(client, problem)
  await db.setVillagePassword(p.highID, p.lowID, args[1])
  client.log(`[Account] password changed for village ${keyOf(p)}`)
  await say(client, 'Password changed.')
}

/** /logout: this phone leaves the village and gets a new empty one; the old village stays safe behind its password. */
async function logout (client) {
  const db = client.mongoose
  const p = client.player
  if (!(await db.hasVillagePassword(p.highID, p.lowID))) {
    return say(client, 'This village has no password, so you could never come back to it. Set one first: /register <password>')
  }
  const fresh = await db.createNewPlayer()
  client.log(`[Account] logout: ${keyOf(p)} -> new village ${keyOf(fresh)}`)
  await say(client, `Logged out. Come back with /login ${p.lowID} <password>. Loading a new village...`)
  await switchTo(client, fresh)
}

async function switchTo (client, target) {
  client.log(`[Account] switching to village ${keyOf(target)}`)
  await say(client, `Loading ${target.name && target.name !== 'You' ? target.name : 'the village'}...`)
  await new UnlockAccountOkMessage(client, target.highID, target.lowID, target.token).send()
}

/** /redeem <code>: gems from a code (Gamefiles/redeem_codes.json). The game is not reloaded unless "reloadAfterRedeem" is true in the file. */
async function redeemCommand (client, args) {
  const result = await RedeemCodes.redeem(client, args[0])
  await say(client, result.message)
  if (!result.ok) return
  if (RedeemCodes.reloadAfterRedeem()) {
    await say(client, 'Reloading to show your gems...')
    await reloadClient(client)
  } else if (RedeemCodes.showGemsNow()) {
    // Same as the Boost command: the home data carries the gem balance, so the game shows it at once (no reload).
    try {
      const OwnHomeDataMessage = require('../Protocol/Messages/Server/OwnHomeDataMessage')
      await new OwnHomeDataMessage(client).send()
    } catch (e) {
      console.error('[Redeem] could not refresh the home data:', e.message)
      await say(client, 'Your gems are saved and show the next time the game loads.')
    }
  } else {
    await say(client, 'Your gems are saved and show the next time the game loads.')
  }
}

/** /id: the id of this village (the number after # is what /visit takes). */
async function showId (client) {
  const p = client.player
  await say(client, `Village ${p.name || '(no name)'}: ID ${p.highID}-${p.lowID} (#${p.lowID})`)
}

/** A connection counts as online while its socket is open and it has been heard from recently (a phone that lost
 *  its network leaves a half-open socket behind, which is not an online player). */
const ONLINE_WINDOW_MS = 5 * 60000

function onlineClients () {
  const now = Date.now()
  const list = []
  for (const c of PlayerManager.getAll()) {
    if (!c || c.destroyed || c.writable === false) continue
    if (c.lastSeen && now - c.lastSeen > ONLINE_WINDOW_MS) continue
    list.push(c)
  }
  return list
}

const fmtDuration = sec => {
  const d = Math.floor(sec / 86400); const h = Math.floor(sec % 86400 / 3600)
  const m = Math.floor(sec % 3600 / 60); const x = Math.floor(sec % 60)
  return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${x}s`].filter(Boolean).join(' ')
}

/** /status: the real server state. */
async function showStatus (client) {
  const mb = n => Math.round(n / 1048576)
  const conns = onlineClients()
  const inGame = new Set(conns.filter(c => c.player).map(c => keyOf(c.player)))
  const db = client.mongoose

  const count = async (table) => {
    try { return Number((await db.query(`SELECT COUNT(*) AS \`n\` FROM \`${table}\``))[0].n) } catch (e) { return '?' }
  }
  const [players, clans] = await Promise.all([count('players'), count('clans')])

  const mem = process.memoryUsage()
  const lines = [
    `Online Players: ${inGame.size}`,
    `Number of all players: ${players}`,
    `Number of all clans: ${clans}`,
    `RAM using: ${mb(mem.rss)} MB`,
    `Uptime: ${fmtDuration(process.uptime())}`
  ]
  await say(client, lines.join('\n'))
}

// ------------------------------------------------------------ /base

const LEVEL_DIR = path.join('Gamefiles', 'level')
const BACKUP_DIR = path.join('Database', 'base_backups')
const BASE_KEYS = ['buildings', 'obstacles', 'traps', 'decos', 'respawnVars', 'cooldowns']

/** The bases in Gamefiles/level: townhall1..N first, then npc1..N (starting_home / tutorial files are not bases). */
function listBases () {
  let files = []
  try { files = fs.readdirSync(LEVEL_DIR) } catch (e) { return [] }
  const names = files.filter(f => /^(townhall|npc)\d+\.json$/.test(f)).map(f => f.slice(0, -5))
  const num = n => Number(n.replace(/\D+/g, ''))
  const group = n => n.startsWith('townhall') ? 0 : 1
  return names.sort((a, b) => group(a) - group(b) || num(a) - num(b))
}

function baseName (arg) {
  const a = String(arg || '').toLowerCase().replace(/\.json$/, '')
  const bases = listBases()
  if (bases.includes(a)) return a
  const m = /^th(\d+)$/.exec(a)
  return m && bases.includes('townhall' + m[1]) ? 'townhall' + m[1] : null
}

const backupFile = p => path.join(BACKUP_DIR, `${p.highID}-${p.lowID}.json`)

async function reloadClient (client) {
  const p = client.player
  await new UnlockAccountOkMessage(client, p.highID, p.lowID, p.token).send() // the game reloads and logs in again
}

async function baseCommand (client, args) {
  const p = client.player
  const arg = (args[0] || '').toLowerCase()
  const bases = listBases()
  if (!arg) {
    const th = bases.filter(b => b.startsWith('townhall')).map(b => b.slice(8))
    const npc = bases.filter(b => b.startsWith('npc')).map(b => b.slice(3))
    return say(client, [
      'Bases (Gamefiles/level):',
      `townhall: ${th.join(', ')}`,
      `npc: ${npc.join(', ')}`,
      'Use /base townhall8 or /base th8 or /base npc12.',
      'Your current village is saved first: /base undo brings it back.'
    ].join('\n'))
  }

  if (arg === 'undo') {
    let saved
    try { saved = fs.readFileSync(backupFile(p), 'utf8') } catch (e) { return say(client, 'No saved village to bring back.') }
    p.village = saved
    if (typeof p.markModified === 'function') p.markModified('village')
    await p.save()
    client.log('[Account] /base undo')
    await say(client, 'Your old village is back. Reloading...')
    return reloadClient(client)
  }

  const name = baseName(arg)
  if (!name) return say(client, `No base called ${arg}. Type /base to see the list.`)
  let level
  try { level = JSON.parse(fs.readFileSync(path.join(LEVEL_DIR, name + '.json'), 'utf8')) } catch (e) { return say(client, 'That base could not be read.') }

  let old = {}
  try { old = JSON.parse(p.village) } catch (e) { /* new village */ }
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    if (p.village) fs.writeFileSync(backupFile(p), p.village) // so /base undo can bring it back
  } catch (e) { return say(client, 'Could not save your old village, so nothing was changed.') }

  // Keep the research (unit_levels ...) of the village; take the layout (buildings, obstacles, traps, decos) from the base.
  const village = Object.assign({}, old)
  for (const k of ['layouts', 'activeLayout', 'quick_train']) delete village[k] // they refer to the old buildings
  for (const k of BASE_KEYS) if (level[k] !== undefined) village[k] = level[k]
  p.village = JSON.stringify(village)
  if (typeof p.markModified === 'function') p.markModified('village')
  await p.save()
  client.log(`[Account] /base ${name} (${(level.buildings || []).length} buildings)`)
  await say(client, `Loaded ${name} (${(level.buildings || []).length} buildings). Reloading...`)
  return reloadClient(client)
}

/** Handles a global chat line that starts with "/". Returns true when it was an account command. */
async function handle (client, text) {
  if (!client.player || !client.mongoose || typeof client.mongoose.checkVillagePassword !== 'function') return false
  const parts = String(text).slice(1).trim().split(/\s+/).filter(Boolean)
  const cmd = (parts[0] || '').toLowerCase()
  const args = parts.slice(1)
  client.log(`[Account] chat command /${cmd}`) // the arguments can hold a password: only the name is logged
  try {
    switch (cmd) {
      case 'register': await register(client, args); break
      case 'login': await login(client, args); break
      case 'password': await changePassword(client, args); break
      case 'logout': case 'new': await logout(client); break
      case 'help': case '?': await say(client, HELP.join('\n')); break
      case 'base': case 'bases': await baseCommand(client, args); break
      case 'redeem': await redeemCommand(client, args); break
      case 'id': await showId(client); break
      case 'status': await showStatus(client); break
      default: await say(client, HELP.join('\n'))
    }
  } catch (e) {
    console.error('[Account] command failed:', e.message)
    await say(client, 'Something went wrong. Try again.')
  }
  return true
}

module.exports = { handle }
