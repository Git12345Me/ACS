const PiranhaMessage = require('../../PiranhaMessage')
const ClientHome = require('../../../Logic/ClientHome')
const ClientAvatar = require('../../../Logic/ClientAvatar')

class EnemyHomeDataMessage extends PiranhaMessage {
  constructor (client, enemy) {
    super()
    this.id = 24107
    this.client = client
    this.version = 1
    this.enemy = enemy
  }

  async encode () {
    this.writeInt(10)

    // Someone
    {
      new ClientHome().encode(this, this.enemy, 0)
      // the storage "Max:" bars in attack mode must be the attacker's own (same sum as the home village)
      try { this.capsOverride = require('../../../Core/ResourceProduction').storageCapacity(JSON.parse(this.client.player.village)) } catch (e) {}
      await new ClientAvatar().encode(this, this.enemy)
      this.capsOverride = null
    }

    await new ClientAvatar().encode(this, this.client.player)

    this.writeInt(3)
    this.writeByte(0) // NpcID
  }
}

module.exports = EnemyHomeDataMessage