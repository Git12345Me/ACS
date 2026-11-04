const PiranhaMessage = require('../../PiranhaMessage')

/** 24337 - 0 NO_LONGER_AVAILABLE, 1 INVALID_WAR, 2 INTERNAL. */
class WarDataErrorMessage extends PiranhaMessage {
  constructor (client, code = 1) {
    super()
    this.id = 24337
    this.client = client
    this.version = 1
    this.code = code
  }

  encode () {
    this.writeInt(this.code)
  }
}

module.exports = WarDataErrorMessage
