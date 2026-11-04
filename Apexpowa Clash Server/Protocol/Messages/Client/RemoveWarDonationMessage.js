const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')

/** 15003 - take back your war donation: int unit (data ref), int value (not interpreted). The unit is lost. */
class RemoveWarDonationMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15003
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.Unit = this.readInt()
    this.data.Value = this.readInt()
  }

  async process () {
    if (!this.client.player) return
    WarManager.attach(this.client.mongoose)
    const ok = await WarManager.removeDonation(this.client, this.data.Unit)
    this.client.log(`[War] war donation ${this.data.Unit} ${ok ? 'removed' : 'not found'}`)
  }
}

module.exports = RemoveWarDonationMessage
