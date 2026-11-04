const EnemyHomeDataMessage = require('../../Messages/Server/EnemyHomeDataMessage')
const AttackHomeFailedMessage = require('../../Messages/Server/AttackHomeFailedMessage')

class LogicMatchmakingCommand {
  async decode (self) {}

  async process (self) {
    await new Promise(resolve => {
      self.client.mongoose.getRandomPlayer(
        self.client.player.lowID,
        (err, enemy) => {
          if (!enemy) {
            console.log("No enemies found!")
            // Tell the game (24103, code 7 "no matches") instead of leaving it on the searching screen.
            new AttackHomeFailedMessage(self.client, AttackHomeFailedMessage.CODES.NO_MATCHES).send().catch(() => {})
            resolve()
            return
          }

          self.client.attackEnemy = enemy
          self.client.attackDeployed = false
          self.client.battleEvents = []
          new EnemyHomeDataMessage(self.client, enemy).send()

          resolve()
        }
      )
    })
  }
}

module.exports = LogicMatchmakingCommand