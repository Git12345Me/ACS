const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')

/** 15009 - mark a base as "called" by you: long targetAvatarId, long ownAvatarId. */
class CallTargetMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15009
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.TargetId = this.readLong()
    this.data.OwnId = this.readLong()
  }

  async process () {
    const t = this.data.TargetId
    await WarManager.callTarget(this.client, `${t[0]}-${t[1]}`)
  }
}

module.exports = CallTargetMessage
