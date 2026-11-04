const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 24111 carrying server command 13: tells the client a war command failed (wars.md 11.4).
 * commandType 560/581/582 -> start-war failed popup, code: 1 NO_RIGHTS, 2 NOT_ENOUGH_MEMBERS, 3 GENERIC,
 * 4 ALREADY_IN_WAR, 5 NOT_IN_ALLIANCE, 6 PENDING_REQUEST_EXISTS, 10 WAR_COOLDOWN_ACTIVE.
 * Layout: int 13, int commandType, int code, int serverCommandId (not -1), int executeSubTick.
 * The client echoes command 13 back inside the next EndClientTurn (see LogicWarFailedEchoCommand).
 */
class StartWarFailedMessage extends PiranhaMessage {
  constructor (client, commandType, code) {
    super()
    this.id = 24111
    this.client = client
    this.version = 1
    this.commandType = commandType
    this.code = code
  }

  encode () {
    this.writeInt(13)
    this.writeInt(this.commandType)
    this.writeInt(this.code)
    this.writeInt(1) // server command id (anything but -1, same as the other server commands)
    this.writeInt(-1) // execute sub tick
  }
}

module.exports = StartWarFailedMessage
