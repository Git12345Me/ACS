// Logic command 521. Not implemented before, so the server dropped the rest of
// the turn (including the obstacle clears that followed it).
//
// Layout inferred from the logged bytes, not from the client binary:
//   int  Tick     (332, then 387 in the next one: increasing like a tick)
//   byte Flag     (01 both times)
// After it the stream continues with a normal command (0x1fb = 507).
class LogicFreeWorkerCommand {
  async decode (self) {
    this.data = {}

    this.data.Tick = self.readInt()
    this.data.Flag = self.readByte()
  }

  async process (self) {
    // Worker state is not modelled by this server, so there is nothing to apply.
  }
}

module.exports = LogicFreeWorkerCommand
