// Logic command 505. In this server's village model, speeding up an obstacle
// clearing finishes the pending clear immediately.
const LogicClearObstacleCommand = require('./LogicClearObstacleCommand')

class LogicSpeedUpClearingCommand {
  async decode (self) {
    this.data = {
      ObstacleID: self.readInt(),
      Unknown: self.readInt()
    }
  }

  async process (self) {
    // Keep obstacle lookup, validation, persistence, and save handling
    // identical to LogicClearObstacleCommand.
    const clearCommand = new LogicClearObstacleCommand()
    clearCommand.data = this.data
    clearCommand.finish = true // speed-up: finish now, no cost here (the gems were charged by the game's own command)
    await clearCommand.process(self)
  }
}

module.exports = LogicSpeedUpClearingCommand