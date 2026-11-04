const PiranhaMessage = require('../../PiranhaMessage')
const NpcDataMessage = require('../Server/NpcDataMessage')
const EnemyHomeDataMessage = require('../Server/EnemyHomeDataMessage')
const Npcs = require('../../../Core/Npcs')

// 14134: the player taps Attack on an NPC (goblin map).
// config.json "Npc": { "Mode": "enemy" | "npc" }  (read on every tap)
//   enemy (default): the NPC goes out as an enemy village with the attack message 24107 that already works for
//          player attacks (army bar, End Battle, no trophies or loot are changed on the server)
//   npc: the NPC message 24133 (see NpcDataMessage)
class AttackNpcMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14134
    this.version = 1
  }

  async decode () {
    this.data = {}

    this.data.LevelID = this.readInt()
  }

  async process () {
    const c = this.client
    if (Npcs.options().mode === 'npc') {
      await new NpcDataMessage(c, this.data.LevelID).send()
      return
    }
    c.attackEnemy = null // an NPC battle changes no trophies or loot on the server
    c.attackDeployed = false
    c.battleEvents = []
    const enemy = Npcs.fakeEnemy(c.player, this.data.LevelID)
    c.log(`[Npc] NPC ${this.data.LevelID} sent as an enemy village (attack message 24107), id ${enemy.highID}-${enemy.lowID}, village ${JSON.parse(enemy.village).buildings.length} buildings`)
    await new EnemyHomeDataMessage(c, enemy).send()
  }
}

module.exports = AttackNpcMessage
