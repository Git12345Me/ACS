const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')
const AllianceWarEntryMessage = require('../Server/AllianceWarEntryMessage')
const AllianceDataFailedForFriendlyWarMessage = require('../Server/AllianceDataFailedForFriendlyWarMessage')

/**
 * 14332 - AskForAllianceWarData: the game asks for the war entry of a clan (its own, when the war button is tapped).
 * Until it is answered with 24329 AllianceWarEntry the game shows "Clan wars are still loading, please try again".
 * Body: a clan id (LONG). If the body is shorter than that, the player's own clan is meant.
 */
class AskForAllianceWarDataMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14332
    this.version = 1
  }

  async decode () {
    this.data = {}
    this.data.Raw = Buffer.from(this.buffer || []).slice(this.offset || 0, (this.offset || 0) + 16).toString('hex')
    try {
      const [high, low] = this.readLong()
      this.data.AllianceId = [high, low]
    } catch (e) {
      this.data.AllianceId = null
    }
  }

  async process () {
    const client = this.client
    const player = client.player
    WarManager.attach(client.mongoose)

    let high = player && player.inClan && player.clan ? player.clan.ClanHighID : 0
    let low = player && player.inClan && player.clan ? player.clan.ClanLowID : 0
    const asked = this.data.AllianceId
    if (asked && (asked[0] || asked[1])) { high = asked[0]; low = asked[1] }

    const side = await WarManager.entryFor(high, low)
    client.log(`[War] 14332 AskForAllianceWarData raw=${this.data.Raw} clan=${high}-${low} -> ${side ? `entry with ${side.members.length} member(s)` : 'clan not found'}`)
    if (!side) {
      // reason 2 = could not be loaded: the game stops waiting for the clan data
      await new AllianceDataFailedForFriendlyWarMessage(client, 2, [high, low]).send()
      return
    }
    await new AllianceWarEntryMessage(client, side, WarManager.EXP).send()
  }
}

module.exports = AskForAllianceWarDataMessage
