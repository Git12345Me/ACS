// Client command 2: LeaveAlliance.
// Decode the observed 16-byte payload (alliance id, reason, tick) so it does not
// get misreported as an unknown command or consume later commands in the turn.
// Actual leaving is handled by the LeaveAllianceMessage (14308).
class LogicLeaveAllianceCommand {
  async decode (stream) {
    this.data = {}
    const [highID, lowID] = stream.readLong()
    this.data.HighID = highID
    this.data.LowID = lowID
    this.data.Reason = stream.readInt()
    this.data.Tick = stream.readInt()
  }

  async process (stream) {
    if (stream.client && stream.client.log) {
      stream.client.log(`[Clan] LeaveAlliance command decoded for ${this.data.HighID}-${this.data.LowID}; actual leave is handled by message 14308.`)
    }
  }
}

module.exports = LogicLeaveAllianceCommand
