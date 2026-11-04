const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')
const WarBaseVisitDataMessage = require('../Server/WarBaseVisitDataMessage')
const WarBaseVisitFailedMessage = require('../Server/WarBaseVisitFailedMessage')

/** 15000 - scout a war base: long target avatar, int arranged, bool hasClan [+ long clan]. Answer 25003, or 25001. */
class VisitWarBaseMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15000
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.TargetId = this.readLong()
    this.data.Arranged = this.readInt()
  }

  async process () {
    const client = this.client
    const t = this.data.TargetId
    WarManager.attach(client.mongoose)
    const found = client.player ? WarManager.findWarBase(client, `${t[0]}-${t[1]}`) : null
    if (!found) {
      client.log(`[War] war base ${t[0]}-${t[1]} not available`)
      await new WarBaseVisitFailedMessage(client).send()
      return
    }
    try {
      const real = await client.mongoose.getPlayerByID(t[0], t[1])
      if (!real) throw new Error('owner not found')
      // The base shown is the roster snapshot taken when the war was made, not the owner's current village.
      const owner = Object.assign({}, real, { village: found.member.base || real.village, save: async () => {}, markModified: () => {} })
      await new WarBaseVisitDataMessage(client, owner, found.w.type === 1 ? 1 : 0).send()
    } catch (e) {
      console.error('[War] could not send the war base:', e.message)
      await new WarBaseVisitFailedMessage(client).send()
    }
  }
}

module.exports = VisitWarBaseMessage
