const PiranhaMessage = require('../../PiranhaMessage')
const ClientAvatar = require('../../../Logic/ClientAvatar')
const Npcs = require('../../../Core/Npcs')

// Answer to 14134 AttackNpc: message 24133. Layout read from this client's libg.so (decode @0x12a8f8, game log
// "Loaded npc home from server (passed time %i)", game mode 2 = attack):
//   INT passed time (0)
//   STRING the NPC village JSON (the game wraps it in the same 0x28-byte "home" object that 24101 OwnHomeData uses)
//   the player's avatar (ClientAvatar, the 0xe0-byte object)
//   a 0x64-byte object that holds an NPC data reference (table 16 = 17xxxxxx):
//       layout A (default): INT 0, INT npc id        (what the game's object decoder reads: base INT, then the data id)
//       layout B: INT npc id, BYTE 0                  (the C# server's version)
// config.json "Npc": { "Mode": "npc" | "enemy", "Layout": "A" | "B", "LevelFiles": true | false }
class NpcDataMessage extends PiranhaMessage {
  constructor (client, levelID) {
    super()
    this.client = client
    this.levelID = levelID
    this.opt = Npcs.options()
    this.id = 24133
    this.version = 10
  }

  async encode () {
    const o = this.opt
    const village = Npcs.home(this.levelID) || Npcs.fakeEnemy(this.client.player, this.levelID).village
    this.writeInt(0) // passed time
    this.writeString(typeof village === 'string' ? village : JSON.stringify(village))
    await new ClientAvatar().encode(this, this.client.player)
    if (o.layout === 'B') {
      this.writeInt(this.levelID)
      this.writeByte(0)
    } else {
      this.writeInt(0)
      this.writeInt(this.levelID)
    }
    this.client.log(`[Npc] sent NPC ${this.levelID} (24133, layout ${o.layout}, map "${Npcs.mapName(this.levelID)}")`)
  }
}

module.exports = NpcDataMessage
