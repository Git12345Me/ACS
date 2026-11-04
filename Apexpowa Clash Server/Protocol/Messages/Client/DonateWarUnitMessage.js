const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')

/** 15002 - donate a unit to a clan mate's war Clan Castle: int unit (data ref), long target avatar, bool quick. */
class DonateWarUnitMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15002
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.Unit = this.readInt()
    this.data.TargetId = this.readLong()
  }

  async process () {
    const client = this.client
    if (!client.player) return
    WarManager.attach(client.mongoose)
    const t = this.data.TargetId
    const why = await WarManager.donateUnit(client, this.data.Unit, `${t[0]}-${t[1]}`)
    client.log(why ? `[War] war donation refused: ${why}` : `[War] war donation ${this.data.Unit} -> ${t[0]}-${t[1]}`)
  }
}

module.exports = DonateWarUnitMessage
