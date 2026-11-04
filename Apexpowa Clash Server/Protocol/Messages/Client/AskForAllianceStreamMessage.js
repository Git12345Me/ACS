const PiranhaMessage = require('../../PiranhaMessage')
const AllianceStreamMessage = require('../Server/AllianceStreamMessage')
const WarManager = require('../../../Core/WarManager')

class AskForAllianceStreamMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14314
    this.version = 1
  }

  async decode () {}

  async process () {
    const player = this.client.player
    if (!player.inClan) return

    try {
      await new AllianceStreamMessage(this.client, player.clan.ClanHighID, player.clan.ClanLowID).send()
    } catch (e) { console.error(e) }
    // a player who just joined a clan has not received a war state yet (the war button says "still loading" without one)
    try { WarManager.attach(this.client.mongoose); await WarManager.sendWarTo(this.client) } catch (e) { console.error(e) }
  }
}

module.exports = AskForAllianceStreamMessage
