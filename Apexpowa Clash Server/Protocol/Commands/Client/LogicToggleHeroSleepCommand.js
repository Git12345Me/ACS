/**
 * Command 529 - ToggleHeroSleep (port of ToggleHeroSleepCommand)
 * Layout: INT altar (building) id, BYTE sleep flag (1 = send the hero to sleep, 0 = wake), INT tick
 * (a -1 INT in front of the tick is skipped, as in the other commands of this client).
 *
 * The hero state is kept on the altar in the village JSON (`hero_sleep`) and sent to the game in ClientAvatar
 * (array 9: 2 = sleeping, 3 = awake / guarding).
 */
const Utils = require('../../../Utilities/Utils')

const HERO_ALTARS = new Set([1000022, 1000025]) // Barbarian King, Archer Queen

class LogicToggleHeroSleepCommand {
  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.FlagSleep = self.readByte()
    let next = self.readInt()
    if (next === -1 || next === 0xffffffff) next = self.readInt()
    this.data.Tick = next
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[LogicToggleHeroSleepCommand] ${msg}`) }
    if (!player) return -1

    const id = this.data.BuildingID
    let village
    try { village = JSON.parse(player.village) } catch (e) { return log('player has no readable village'), -1 }

    const altar = Utils.getClassID(id) === 500 && Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(id)] : null
    if (!altar || !HERO_ALTARS.has(altar.data)) return log(`object ${id} is not a hero altar`), -1

    altar.hero_sleep = this.data.FlagSleep === 1
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`altar ${id} (${altar.data === 1000022 ? 'King' : 'Queen'}) -> ${altar.hero_sleep ? 'sleeping' : 'awake'}`)
    return 0
  }

  destruct () { this.data = {} }
}

module.exports = LogicToggleHeroSleepCommand
