const PiranhaMessage = require('../../PiranhaMessage')

class SetDeviceTokenMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 10113
    this.version = 1
  }

  async decode () {
    this.data = {}
    this.data.Token = this.readString()
    this.data.Unknown = this.readInt()
  }

  async process () {} // Push notifications are not supported
}

module.exports = SetDeviceTokenMessage
