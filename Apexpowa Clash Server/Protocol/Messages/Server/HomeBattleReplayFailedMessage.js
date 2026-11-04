const PiranhaMessage = require('../../PiranhaMessage')

class HomeBattleReplayFailedMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24116
    this.client = client
    this.version = 1
  }

  async encode () {}
}

module.exports = HomeBattleReplayFailedMessage
