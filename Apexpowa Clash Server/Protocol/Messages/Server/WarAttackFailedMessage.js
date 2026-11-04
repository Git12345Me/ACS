const PiranhaMessage = require('../../PiranhaMessage')

/** 25002 - TID_ALLIANCE_WAR_ATTACK_FAILED_*. Codes: 3 target not in war, 4 invalid target, 5 all attacks used,
 *  6 target under attack, 8 generic, 13 attacking same target, 14 war is ending (wars.md 12.3). */
class WarAttackFailedMessage extends PiranhaMessage {
  constructor (client, code, targetId) {
    super()
    this.id = 25002
    this.client = client
    this.version = 1
    this.code = code
    this.targetId = targetId || [0, 0]
  }

  encode () {
    this.writeInt(this.code)
    this.writeLong(this.targetId[0], this.targetId[1])
  }
}

module.exports = WarAttackFailedMessage
