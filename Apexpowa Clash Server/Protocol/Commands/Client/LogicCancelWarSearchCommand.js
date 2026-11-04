const WarManager = require('../../../Core/WarManager')

const STATE_NAMES = { 0: 'no war', 1: 'searching', 4: 'preparation day', 5: 'battle day', 6: 'ended' }

/** Why a cancel cannot work, for the log: the war manager only answers true / false. */
function whyNotCancelled (client) {
  const p = client.player
  if (!p || !p.inClan || !p.clan) return 'the player is not in a clan'
  if (p.clan.ClanRole !== 2 && p.clan.ClanRole !== 4) return 'only the leader or a co-leader can cancel the search'
  const key = `${p.clan.ClanHighID}-${p.clan.ClanLowID}`
  const war = WarManager._data().wars.find(w => w.A.key === key || (w.B && w.B.key === key))
  if (!war) return 'the clan has no war search running (already cancelled, or the server was restarted)'
  if (war.state !== WarManager.STATE.SEARCHING) {
    return `the clan is already past searching: ${STATE_NAMES[war.state] || 'state ' + war.state}` +
      (war.B ? ` against ${war.B.key === key ? war.A.name : war.B.name}` : '')
  }
  return 'unknown'
}

/** Command 561 - cancel the war search. Body: int subTick only. The client has no failure text for it. */
class LogicCancelWarSearchCommand {
  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
  }

  async process (self) {
    WarManager.attach(self.client.mongoose)
    const reason = whyNotCancelled(self.client) // read before cancelling, while the war still exists
    const ok = await WarManager.cancelSearch(self.client)
    self.client.log(ok ? '[War] cancel war search -> true' : `[War] cancel war search -> false: ${reason}`)
  }
}

module.exports = LogicCancelWarSearchCommand
