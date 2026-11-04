// A trap (or another triggered object) went off during a battle. The attacker's game reports it to the server
// so the server can replay the battle. Payload, as this client sends it (INTs, like its other commands):
//   INT   game object id   (e.g. 504000003, a trap in the defender's village)
//   INT   data id          (e.g. 12000000, the trap type)
//   STRING json            (the object's saved state, starts with '{')
//   INT   tick
// ACS does not simulate battles, so nothing is applied; the command only has to be read in full, or the rest
// of the turn (including the end of the battle) would be dropped. EndClientTurnMessage learns its id from the
// shape of the payload the first time it arrives (Gamefiles/learned_commands.json, key "trigger").
class LogicTriggerComponentTriggeredCommand {
  async decode (self) {
    this.data = {}
    this.data.ObjectID = self.readInt()
    this.data.DataID = self.readInt()
    this.data.Json = self.readString() || ''
    this.data.Tick = self.readInt()
  }

  async process (self) {}
}

module.exports = LogicTriggerComponentTriggeredCommand
