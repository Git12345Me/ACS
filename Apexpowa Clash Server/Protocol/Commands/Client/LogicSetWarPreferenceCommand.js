const WarManager = require('../../../Core/WarManager')

/** Command 570 - war preference: int preference (1 = in, 0 = out), then int subTick. */
class LogicSetWarPreferenceCommand {
  async decode (self) {
    this.data = {}
    // the client's encoder writes the preference first and the base subTick last (verified against the client: int 1, int -1)
    this.data.Preference = self.readInt() !== 0 ? 1 : 0
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = self.client
    if (!client || !client.player) return
    WarManager.attach(client.mongoose)
    WarManager.setPreference(client.player, this.data.Preference)
    client.log(`[War] war preference -> ${this.data.Preference ? 'in' : 'out'}`)
  }
}

module.exports = LogicSetWarPreferenceCommand
