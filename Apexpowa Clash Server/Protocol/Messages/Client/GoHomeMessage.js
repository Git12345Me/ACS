const PiranhaMessage = require('../../PiranhaMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')

class GoHomeMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14101
    this.version = 1
  }

  async decode () {}

  async process () {
    if (this.client.warAttack) { // leaving a clan war battle without an end-combat command
      await require('../../../Core/WarManager').finishAttack(this.client)
    }
    // leaving an attack: the battle result (loot, trophies) is settled here if no end-combat command came
    if (this.client.attackEnemy) {
      console.log('[Logic] battle: GoHome received, settling the attack')
      await require('../../Commands/Client/LogicEndCombatCommand').finish(this.client)
    }
    await new OwnHomeDataMessage(this.client).send()
  }
}

module.exports = GoHomeMessage