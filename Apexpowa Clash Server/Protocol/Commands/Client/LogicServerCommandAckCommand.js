// The client repeats every server command (24111 AvailableServerCommand) inside its next
// EndClientTurn once it has executed it. Without a handler for those ids the rest of the turn
// is dropped. Layouts are what the server sent, then the client's tick:
//   1 (join clan):   LONG clanId, STRING name, INT badge, BYTE, INT level, INT tick
//   3 (name change): STRING name, INT tick
class LogicServerCommandAckCommand {
  constructor (commandID) {
    this.commandID = commandID
  }

  async decode (self) {
    this.data = {}
    if (this.commandID === 1) {
      this.data.ClanId = self.readLong()
      this.data.Name = self.readString()
      this.data.Badge = self.readInt()
      this.data.Flag = typeof self.readByte === 'function' ? self.readByte() : (self.readBoolean() ? 1 : 0)
      this.data.Level = self.readInt()
    } else if (this.commandID === 3) {
      this.data.Name = self.readString()
    }
    this.data.Tick = self.readInt()
  }

  async process (self) {}
}

// Commands that only carry a tick (seen as `541: 4 bytes left`).
class LogicTickOnlyCommand {
  async decode (self) {
    this.data = { Tick: self.readInt() }
  }

  async process (self) {}
}

// 540: a text and the tick (seen as `00 00 00 04 "test" 00 00 02 c0`, sent together with a troop
// request that used that text). Its purpose is unknown, so it is only read, not acted on.
class LogicTextTickCommand {
  async decode (self) {
    this.data = { Text: self.readString(), Tick: self.readInt() }
  }

  async process (self) {}
}

module.exports = { LogicServerCommandAckCommand, LogicTickOnlyCommand, LogicTextTickCommand }
