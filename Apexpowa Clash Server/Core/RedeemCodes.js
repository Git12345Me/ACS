// /redeem <code>: gems for players who type a valid code in chat.
// Codes live in Gamefiles/redeem_codes.json (code, gems, maxPlayers, expires) and are re-read when the file changes.
// A village can use a code once; at most maxPlayers villages can use it; after "expires" (UTC) it stops working.
// Who used which code is stored in the database (table redeem_claims), so it survives restarts.
const fs = require('fs')
const path = require('path')

const FILE = path.join('Gamefiles', 'redeem_codes.json')
let cache = { mtime: -1, codes: [], reload: false, showNow: true }

/** "2026-12-31" or "2026-12-31 23:59" (UTC) -> ms, or null when it is not a date. */
function parseExpiry (text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(String(text || '').trim())
  if (!m) return null
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] || '23', m[5] || '59'].map(Number)
  return Date.UTC(y, mo - 1, d, h, mi, 59)
}

function loadCodes () {
  try {
    const mtime = fs.statSync(FILE).mtimeMs
    if (mtime === cache.mtime) return cache.codes
    const file = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const codes = []
    for (const c of (file.codes || [])) {
      const code = String(c.code || '').trim().toUpperCase()
      const gems = Math.floor(Number(c.gems))
      const maxPlayers = Math.floor(Number(c.maxPlayers))
      if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !(gems > 0) || !(maxPlayers > 0)) {
        console.log(`[Redeem] ignored an invalid entry in ${FILE}: ${JSON.stringify(c)}`)
        continue
      }
      codes.push({ code, gems, maxPlayers, expires: parseExpiry(c.expires), expiresText: c.expires })
    }
    cache = { mtime, codes, reload: file.reloadAfterRedeem === true, showNow: file.showGemsNow !== false }
  } catch (e) {
    console.log(`[Redeem] could not read ${FILE}: ${e.message}`)
    cache = { mtime: -1, codes: [], reload: false, showNow: true }
  }
  return cache.codes
}

const dateText = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

/** Returns { ok, message, gems }. Gems are added to client.player when ok. */
async function redeem (client, rawCode) {
  const p = client.player
  const db = client.mongoose
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) return { ok: false, message: 'Usage: /redeem <code>' }

  const entry = loadCodes().find(c => c.code === code)
  if (!entry) return { ok: false, message: 'That code is not valid.' }
  if (entry.expires !== null && Date.now() > entry.expires) return { ok: false, message: `That code expired on ${dateText(entry.expires)}.` }

  const claim = await db.claimRedeemCode(code, p.highID, p.lowID, entry.maxPlayers)
  if (claim.status === 'already') return { ok: false, message: 'You already used this code.' }
  if (claim.status === 'full') return { ok: false, message: `That code was already used by ${entry.maxPlayers} players.` }

  p.diamonds = (Number(p.diamonds) || 0) + entry.gems
  await p.save()
  client.log(`[Redeem] ${code}: +${entry.gems} gems to ${p.highID}-${p.lowID} (${claim.used}/${entry.maxPlayers})`)
  return {
    ok: true,
    gems: entry.gems,
    message: `Code ${code}: +${entry.gems} gems! (${claim.used}/${entry.maxPlayers} players used it` +
      (entry.expires !== null ? `, valid until ${dateText(entry.expires)}` : '') + ')'
  }
}

/** true when the game should be reloaded after a redeem ("reloadAfterRedeem": true in the file; default false). */
const reloadAfterRedeem = () => { loadCodes(); return cache.reload }

const showGemsNow = () => { loadCodes(); return cache.showNow }

module.exports = { redeem, parseExpiry, reloadAfterRedeem, showGemsNow }
