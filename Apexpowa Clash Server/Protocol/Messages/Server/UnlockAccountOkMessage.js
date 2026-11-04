const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 20132 - UnlockAccountOk: the id and pass token of another village. The client stores them as its account and
 * reloads the game, which then logs in with that village (no lock screen needed).
 */
class UnlockAccountOkMessage extends PiranhaMessage {
  constructor (client, highID, lowID, token) {
    super()
    this.id = 20132
    this.client = client
    this.version = 0
    this.highID = highID
    this.lowID = lowID
    this.token = token
  }

  encode () {
    this.writeLong(this.highID, this.lowID)
    this.writeString(this.token)
  }
}

module.exports = UnlockAccountOkMessage
