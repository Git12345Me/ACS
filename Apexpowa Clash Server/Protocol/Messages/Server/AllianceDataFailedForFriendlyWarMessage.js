const PiranhaMessage = require('../../PiranhaMessage')

/** 24336 - the clan data asked with 14332 could not be loaded. INT reason (1 clan deleted, 2 load failed, 0 generic, else not found), LONG clan id. */
class AllianceDataFailedForFriendlyWarMessage extends PiranhaMessage {
  constructor (client, reason = 0, allianceId = [0, 0]) {
    super()
    this.id = 24336
    this.client = client
    this.version = 1
    this.reason = reason
    this.allianceId = allianceId
  }

  encode () {
    this.writeInt(this.reason)
    this.writeLong(this.allianceId[0], this.allianceId[1])
  }
}

module.exports = AllianceDataFailedForFriendlyWarMessage
