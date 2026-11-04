const PiranhaMessage = require('../../PiranhaMessage')
const AvailableServerCommandMessage = require('../Server/AvailableServerCommandMessage')
const OutOfSyncMessage = require('../Server/OutOfSyncMessage')
const ServerErrorMessage = require('../Server/ServerErrorMessage')
const { postClanEvent } = require('../../../Core/ClanEvents')

class JoinAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14305
    this.version = 1
  }

  async decode () {
    this.data = {}

    // One LONG: the id of the clan to join, as [high, low]. (It used to read two longs and take
    // the high of the first and the low of the second, which gave 0-0 for a clan like 0-5.)
    const [high, low] = this.readLong()
    this.data.ClanHighID = high
    this.data.ClanLowID = low

    //console.log(this.data)
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose

    if (player.inClan) {
      await new OutOfSyncMessage(this.client).send() // Already in a clan
      return
    }

    try {
      const clan = await db.getClanByID(this.data.ClanHighID, this.data.ClanLowID)
      
      if (!clan) {
        await new ServerErrorMessage(this.client, "Clan not found.").send()
        return
      }

      const joined = await db.joinClan(player, clan)
      await new AvailableServerCommandMessage(this.client, 1).send()
      // clan chat: "<name> joined the clan" (green) for every member that is online, saved for the others
      try { await postClanEvent(db, joined || clan, { eventName: 'JOINED', target: player }) } catch (e) { console.error(e) }
    } catch (e) {
      await new ServerErrorMessage(this.client, e.message || "Failed to join clan.").send()
      console.error(e)
    }
  }
}

module.exports = JoinAllianceMessage