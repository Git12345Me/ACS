/**
 * Command 602 - EndAttackPreparation (C# LogicEndAttackPreparationCommand).
 *
 * Layout (C# Decode): nothing but the base tick - INT tick.
 * C# Execute: returns -1 (it does nothing; the command only exists in replays, where it marks the end of the preparation).
 * The replay JSON part of the C# (LoadFromJSON / GetJSONForReplay, a "base" object) is not needed: ACS stores no replays.
 */
class LogicEndAttackPreparationCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 602
  }

  async process () {
    return -1 // same as the C#: nothing to do
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicEndAttackPreparationCommand
