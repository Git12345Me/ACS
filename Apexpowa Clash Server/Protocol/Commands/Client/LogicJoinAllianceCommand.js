// Client command 1: JoinAlliance.
// Captured ACS payload: alliance high/low id, name string, badge, byte, level, tick.
// Clan creation/join membership is handled by the corresponding alliance message;
// this command is decoded to keep the EndClientTurn stream aligned.
class LogicJoinAllianceCommand {
  async decode (stream) {
    this.data = {}
    const [highID, lowID] = stream.readLong()
    this.data.HighID = highID
    this.data.LowID = lowID
    this.data.Name = stream.readString()
    this.data.Badge = stream.readInt()
    // Captured layout (client 8.x): BYTE, INT level, INT tick = 9 bytes. The old code read a 64-bit value
    // here (8 bytes), which left one byte over and shifted the next command id in the same turn.
    this.data.Flag = stream.readByte()
    this.data.Level = stream.readInt()
    this.data.Tick = stream.readInt()
  }

  async process (stream) {
    if (stream.client && stream.client.log) {
      stream.client.log(`[Clan] JoinAlliance command decoded for ${this.data.HighID}-${this.data.LowID} (${this.data.Name}); membership remains handled by alliance messages.`)
    }
  }
}

module.exports = LogicJoinAllianceCommand
