const PiranhaMessage = require('../../PiranhaMessage')
const { getInbox, writeAvatarStreamEntry } = require('../../../Core/AvatarStream')

// 24411: the player's whole inbox (clan mail ...), sent at login and whenever the client asks for it.
class AvatarStreamMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24411
    this.client = client
    this.version = 1
  }

  async encode () {
    const list = getInbox(this.client.player)
    this.writeInt(list.length)
    for (const entry of list) writeAvatarStreamEntry(this, entry)
    this.client.log(`[Logic] mail: sent the inbox (${list.length} mail(s))`)
  }
}

module.exports = AvatarStreamMessage
