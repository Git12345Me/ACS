/**
 * Core/LiveReplay.js - live replay of an attack that is running right now (war attacks: the clan mates watch
 * the attacker). The attacker's own client sends its commands in EndClientTurn (14102); every one of them is
 * copied here (raw bytes, exactly as the client wrote them) and forwarded to the viewers as 24117
 * LiveReplayDataMessage: INT sub tick, INT command count, the commands.
 *
 * Message numbers of THIS client (libg.so): 24117 = data (decode "LiveReplayDataMessage::decode()" @0x12a3b0),
 * 24118 = failed, INT code (1 no data found, 2 no free slots, else generic), 14123 = the request (LONG, INT, LONG).
 * The C# source numbers (24119 ...) belong to a newer protocol.
 */
const MAX_COMMANDS = 512 // the game refuses more commands per message
const MAX_VIEWERS = 8

const sessions = new Map() // key "high-low" of the attacker -> session

const keyOf = p => `${p.highID}-${p.lowID}`

function begin (client, defender) {
  const p = client.player
  if (!p) return null
  const s = { attacker: [p.highID, p.lowID], defender: defender ? [defender.highID, defender.lowID] : null, commands: [], viewers: new Set(), startedAt: Date.now() }
  sessions.set(keyOf(p), s)
  client.liveReplaySession = s
  return s
}

/** One command of the attacker (raw bytes, command id included). Starts the session on the first attack command. */
function feed (client, raw, commandID) {
  if (!client.player) return
  let s = client.liveReplaySession
  if (!s) {
    if (![600, 604, 605].includes(commandID) || !(client.warAttack || client.attackEnemy)) return
    s = begin(client, client.attackEnemy)
  }
  if (s.commands.length < 10000) s.commands.push(Buffer.from(raw))
  if (s.viewers.size) {
    const DataMsg = require('../Protocol/Messages/Server/LiveReplayDataMessage')
    for (const v of s.viewers) {
      new DataMsg(v, s.commands.length - 1, [Buffer.from(raw)]).send().catch(() => s.viewers.delete(v))
    }
  }
}

function end (client) {
  const s = client.liveReplaySession
  if (!s) return
  client.liveReplaySession = null
  sessions.delete(keyOf(client.player))
  const Failed = require('../Protocol/Messages/Server/LiveReplayFailedMessage')
  for (const v of s.viewers) new Failed(v, 1).send().catch(() => {}) // the attack is over
  s.viewers.clear()
}

/** A viewer asks for the live replay of `avatar` (high-low): sends what happened so far, then every new command. */
async function watch (viewer, ids) {
  const Failed = require('../Protocol/Messages/Server/LiveReplayFailedMessage')
  const DataMsg = require('../Protocol/Messages/Server/LiveReplayDataMessage')
  let s = null
  for (const id of ids) { const found = sessions.get(`${id[0]}-${id[1]}`); if (found) { s = found; break } }
  if (!s) {
    for (const x of sessions.values()) if (ids.some(id => x.defender && x.defender[0] === id[0] && x.defender[1] === id[1])) { s = x; break }
  }
  if (!s) return new Failed(viewer, 1).send()
  if (s.viewers.size >= MAX_VIEWERS) return new Failed(viewer, 2).send()
  s.viewers.add(viewer)
  viewer.on && viewer.on('close', () => s.viewers.delete(viewer))
  const first = s.commands.slice(0, MAX_COMMANDS)
  await new DataMsg(viewer, 0, first).send()
  console.log(`[Logic] live replay: ${viewer.player ? viewer.player.name : '?'} watches ${s.attacker.join('-')} (${first.length} command(s) so far, ${s.viewers.size} viewer(s))`)
}

module.exports = { begin, feed, end, watch }
