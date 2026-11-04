/**
 * Command 534 - CancelShield (ends the player's own shield early).
 * Body: int tick only. ACS keeps the shield as a millisecond timestamp in player.shieldDurationSeconds
 * (written by LogicBuyShieldCommand, read by ClientHome), so cancelling = setting it to 0.
 * The guard timer (guardDurationSeconds) is left alone, as in the C# command (it only cleared the shield).
 */
class LogicCancelShieldCommand {
  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const player = self.client.player
    if (!player || !player.shieldDurationSeconds) return 0
    player.shieldDurationSeconds = 0
    if (typeof player.markModified === 'function') player.markModified('shieldDurationSeconds')
    await player.save()
    if (typeof self.client.log === 'function') self.client.log(`[Shield] ${player.name} cancelled the shield`)
    return 0
  }
}

module.exports = LogicCancelShieldCommand
