const PiranhaMessage = require('../../PiranhaMessage')
const { writeAvatarRanking } = require('../../../Core/AvatarRankingWriter')

class AvatarRankingListMessage extends PiranhaMessage {
  constructor (client) {
    super()
    this.id = 24403
    this.client = client
    this.version = 1
  }

  async encode () {
    const db = this.client.mongoose
    const players = await db.getTopPlayers(200)
    await writeAvatarRanking(this, db, players)
  }
}

module.exports = AvatarRankingListMessage
