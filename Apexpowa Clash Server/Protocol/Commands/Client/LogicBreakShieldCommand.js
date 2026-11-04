/**
 * Command BREAK_SHIELD (534 on this client; it is the same "end my shield" command the older server called
 * CancelShield, so register it INSTEAD of LogicCancelShieldCommand). Body: int tick only.
 *
 * Port of the C# LogicBreakShieldCommand (home village only, which is all ACS has):
 *   - no shield left:  shield = 0 and guard = 0
 *   - shield active:   shield = 0, the guard time is kept, and the personal-break cooldown is set
 *                      to the globals' PersonalBreakLimitSeconds
 *
 * The rules and the time units live in Core/Shield.js: shieldDurationSeconds is epoch SECONDS (what LogicBuyShieldCommand
 * writes). This file used to treat it as milliseconds, so a real shield always looked "already over" and the guard time
 * was cleared as well.
 *
 * If LogicPlaceAttackerCommand already broke the shield at the first troop of this battle (Shield.autoBreakOnAttack),
 * this command is ignored once.
 */
const Shield = require('../../../Core/Shield')

class LogicBreakShieldCommand {
  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    const player = client.player
    if (!player) return -1
    const log = msg => { if (typeof client.log === 'function') client.log(`[BreakShield] ${msg}`) }

    if (client.shieldBreakHandled) {
      client.shieldBreakHandled = false
      log(`${player.name}: shield was already broken when the attack started`)
      return 0
    }

    const remaining = Shield.breakShield(player)
    if (remaining <= 0) log(`${player.name}: no shield left, shield and guard cleared`)
    else log(`${player.name}: shield (${remaining}s left) broken, guard ${player.guardDurationSeconds || 0}s kept`)

    await player.save()
    return 0
  }
}

module.exports = LogicBreakShieldCommand
