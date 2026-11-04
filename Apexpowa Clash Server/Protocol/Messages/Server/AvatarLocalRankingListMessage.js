const PiranhaMessage = require('../../PiranhaMessage')
const { writeAvatarRanking } = require('../../../Core/AvatarRankingWriter')

class AvatarLocalRankingListMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24404
    this.client = client
    this.version = 1
  }

  async encode () {
    const db = this.client.mongoose
    const players = await db.getLocalPlayers(200)
    await writeAvatarRanking(this, db, players)
  }
}

module.exports = AvatarLocalRankingListMessage
