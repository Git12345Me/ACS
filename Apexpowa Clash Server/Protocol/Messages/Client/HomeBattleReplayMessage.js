const PiranhaMessage = require('../../PiranhaMessage')
const HomeBattleReplayDataMessage = require('../Server/HomeBattleReplayDataMessage')
const HomeBattleReplayFailedMessage = require('../Server/HomeBattleReplayFailedMessage')

class HomeBattleReplayMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14114
    this.version = 1
  }

  async decode () {
    this.data = {}
    this.data.Unknown = this.readInt()
    const replayId = this.readLong()
    this.data.ReplayHighID = replayId[0]
    this.data.ReplayLowID = replayId[1]
  }

  async process () {
    const replay = require('../../../Core/Replays').getReplay(this.data.ReplayLowID)
    if (!replay) {
      this.client.log(`[Logic] replay: #${this.data.ReplayLowID} not found`)
      await new HomeBattleReplayFailedMessage(this.client).send()
      return
    }
    this.client.log(`[Logic] replay: sending replay #${this.data.ReplayLowID} (${replay.json.length} chars)`)
    await new HomeBattleReplayDataMessage(this.client, replay.json).send()
  }
}

module.exports = HomeBattleReplayMessage
