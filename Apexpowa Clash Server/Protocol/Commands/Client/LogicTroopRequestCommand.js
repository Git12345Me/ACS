// 541: troop request sent by the client as one wrapped command.
//
// Captured payload (after the command id), 44 bytes - the whole rest of the turn:
//   INT     outer tick
//   INT     511  (id of RequestAllianceUnits)
//   INT     tick of the inner command
//   BOOLEAN hasMessage
//   STRING  "I need reinforcement troops"
// i.e. an outer INT followed by a complete command 511 (id, tick, flag, string).
// Inferred from captures: any inner id other than 511 is not understood, so the
// rest of the turn is dropped to keep the stream from desyncing.
const LogicRequestAllianceUnitsCommand = require('./LogicRequestAllianceUnitsCommand')

const REQUEST_ALLIANCE_UNITS = 511

class LogicTroopRequestCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
    this.inner = null
  }

  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
    this.data.InnerID = self.readInt()

    if (this.data.InnerID === REQUEST_ALLIANCE_UNITS) {
      this.inner = new LogicRequestAllianceUnitsCommand(self.client)
      await this.inner.decode(self)
      return
    }

    if (self.client && typeof self.client.log === 'function') {
      self.client.log(`[Clan] command 541 wraps unknown command ${this.data.InnerID}, skipping rest of turn`)
    }
    self.offset = self.buffer.length // length unknown: drop the rest of the turn
  }

  getCommandType () {
    return 541
  }

  async process (self) {
    if (this.inner) return this.inner.process(self)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
    this.inner = null
  }
}

module.exports = LogicTroopRequestCommand
