/**
 * Shield helpers shared by LogicBuyShieldCommand, LogicBreakShieldCommand, LogicCancelShieldCommand,
 * LogicPlaceAttackerCommand and ClientHome.
 *
 * player.shieldDurationSeconds is the epoch time (in SECONDS) when the shield ends. Older ACS versions stored
 * MILLISECONDS there; toSeconds() accepts both (a value above 1e11 can only be milliseconds) so a shield that was
 * bought before the switch still works. The column is a 32-bit INT, which cannot hold milliseconds.
 *
 *   guardDurationSeconds    = seconds, sent as is
 *   personalDurationSeconds = seconds, sent as is (the personal-break cooldown)
 *
 * The personal-break limit is not in globals.csv. Set it in config.json, e.g.
 *   "Shield": { "PersonalBreakLimitSeconds": 86400 }       (default 0 = the cooldown is left unchanged)
 */
let limitSeconds = 0
try { limitSeconds = Number((require('../config.json').Shield || {}).PersonalBreakLimitSeconds) || 0 } catch (e) { limitSeconds = 0 }

const MS_THRESHOLD = 1e11

const nowSeconds = () => Math.floor(Date.now() / 1000)

function toSeconds (value) {
  const n = Number(value) || 0
  return n > MS_THRESHOLD ? Math.floor(n / 1000) : Math.floor(n)
}

/** seconds of shield left (0 = none) */
function remainingSeconds (player, now = nowSeconds()) {
  return Math.max(0, toSeconds(player && player.shieldDurationSeconds) - now)
}

function markShieldFields (player) {
  if (player && typeof player.markModified === 'function') {
    for (const f of ['shieldDurationSeconds', 'guardDurationSeconds', 'personalDurationSeconds']) player.markModified(f)
  }
}

/**
 * Ends the shield (does not save). Same rules as the C# LogicBreakShieldCommand:
 *   - no shield left: shield = 0 and guard = 0
 *   - shield active:  shield = 0, the guard time is kept, the personal-break cooldown is set to the limit
 * @returns {number} the seconds of shield that were left
 */
function breakShield (player) {
  const remaining = remainingSeconds(player)
  if (remaining <= 0) {
    player.shieldDurationSeconds = 0
    player.guardDurationSeconds = 0
  } else {
    player.shieldDurationSeconds = 0
    if (limitSeconds > 0) player.personalDurationSeconds = limitSeconds
  }
  markShieldFields(player)
  return remaining
}

/**
 * Called when the first troop is placed. Attacking another player ends the attacker's own shield, whether or not the
 * client also sends the BREAK_SHIELD command (534). Only for player-vs-player battles: client.battleKind is set to
 * 'player' by the matchmaking command, 'npc' by AttackNpc and 'war' by AttackWarBase. If the shield is broken here,
 * client.shieldBreakHandled makes the 534 command that may follow in the same battle a no-op (otherwise it would see
 * "no shield left" and clear the guard time too).
 */
async function autoBreakOnAttack (client) {
  const player = client && client.player
  if (!player || client.battleKind !== 'player') return false
  if (remainingSeconds(player) <= 0) return false

  const remaining = breakShield(player)
  client.shieldBreakHandled = true
  await player.save()
  if (typeof client.log === 'function') client.log(`[Shield] ${player.name} attacked: shield (${remaining}s left) broken`)
  return true
}

module.exports = { nowSeconds, toSeconds, remainingSeconds, breakShield, autoBreakOnAttack, markShieldFields }
