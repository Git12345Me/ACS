const PiranhaMessage = require('../../PiranhaMessage')
const ClientHome = require('../../../Logic/ClientHome')
const ClientAvatar = require('../../../Logic/ClientAvatar')

/** 25003 - the war base a player scouts (reply to 15000): visitor avatar, base home, owner id, timestamp, arranged flag. */
class WarBaseVisitDataMessage extends PiranhaMessage {
  constructor (client, owner, arranged = 0) {
    super()
    this.id = 25003
    this.client = client
    this.version = 1
    this.owner = owner // player object whose village is the war snapshot
    this.arranged = arranged
  }

  async encode () {
    await new ClientAvatar().encode(this, this.client.player) // visitor
    new ClientHome().encode(this, this.owner, 0) // the war base
    this.writeLong(this.owner.highID, this.owner.lowID) // owner id
    this.writeInt(Math.floor(Date.now() / 1000)) // timestamp
    this.writeInt(this.arranged)
  }
}

module.exports = WarBaseVisitDataMessage
