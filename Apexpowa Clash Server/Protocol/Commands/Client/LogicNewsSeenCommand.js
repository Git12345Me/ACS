class LogicNewsSeenCommand {
  async decode (self) {
    this.data = {}
    this.data.NewsID = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process (self) {}
}

module.exports = LogicNewsSeenCommand