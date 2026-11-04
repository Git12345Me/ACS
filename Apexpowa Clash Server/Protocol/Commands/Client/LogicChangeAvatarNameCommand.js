// Client command 3: ChangeAvatarName.
// The server sends this command (24111) after the name is set (ChangeAvatarNameMessage, 10212)
// and the client echoes it back inside EndClientTurn. Layout per coc-messages:
// STRING name, INT, INT (tick). It was missing, so command 3 was reported as an unknown command
// and "Skipping rest of turn" threw away every other command in that turn (tutorial progress,
// building purchases, ...), which is why a freshly created account did not keep its progress.
// The name itself is already saved by ChangeAvatarNameMessage, so process() only logs.
class LogicChangeAvatarNameCommand {
  async decode (stream) {
    this.data = {}
    this.data.Name = stream.readString()
    // Only read the trailing INTs that are really there, so a shorter layout cannot read past the packet.
    const hasInt = () => stream.offset + 4 <= stream.buffer.length
    this.data.Unknown = hasInt() ? stream.readInt() : 0
    this.data.Tick = hasInt() ? stream.readInt() : 0
  }

  async process (stream) {
    if (stream.client && stream.client.log) {
      stream.client.log(`[Account] ChangeAvatarName command decoded ("${this.data.Name}"); name is saved by message 10212.`)
    }
  }
}

module.exports = LogicChangeAvatarNameCommand
