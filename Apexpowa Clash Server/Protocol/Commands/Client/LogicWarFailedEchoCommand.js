/**
 * Server command 13 echoed back by the client inside EndClientTurn: int commandType, int code,
 * int serverCommandId, int subTick. Consumed and ignored so the rest of the turn stays aligned.
 */
class LogicWarFailedEchoCommand {
  async decode (self) {
    this.data = {}
    this.data.CommandType = self.readInt()
    this.data.Code = self.readInt()
    this.data.ServerCommandId = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process () {}
}

module.exports = LogicWarFailedEchoCommand
