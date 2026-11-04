class LogicMissionProgressCommand {
  constructor (client = null) {
    this.client = client
  }

  async decode (self) {
    this.data = {}

    this.data.MissionID = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process (self) {
    if (self && self.client && typeof self.client.log === 'function') {
      self.client.log(`[LogicMissionProgressCommand] mission ${this.data.MissionID} (tick ${this.data.Tick})`)
    }
  }
}

module.exports = LogicMissionProgressCommand
