const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')
const WarDataMessage = require('../Server/WarDataMessage')
const WarDataErrorMessage = require('../Server/WarDataErrorMessage')

/** 14336 - open a war from the war log: long allianceId, long warId. Answered with 24335 (or 24337). */
class AskForWarByIdMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14336
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.AllianceId = this.readLong()
    this.data.WarId = this.readLong()
  }

  async process () {
    const w = WarManager.warById(this.data.WarId[1])
    const side = w && WarManager.sideOf(w, `${this.data.AllianceId[0]}-${this.data.AllianceId[1]}`)
    if (!w || !side) {
      await new WarDataErrorMessage(this.client, 1).send() // INVALID_WAR
      return
    }
    await new WarDataMessage(this.client, w, side, WarManager.EXP).send()
  }
}

module.exports = AskForWarByIdMessage
