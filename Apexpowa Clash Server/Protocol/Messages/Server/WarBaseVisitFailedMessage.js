const PiranhaMessage = require('../../PiranhaMessage')

/** 25001 - empty. The war base could not be loaded (TID_ALLIANCE_WAR_VISIT_FAILED). */
class WarBaseVisitFailedMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 25001
    this.client = client
    this.version = 0
  }

  encode () {}
}

module.exports = WarBaseVisitFailedMessage
