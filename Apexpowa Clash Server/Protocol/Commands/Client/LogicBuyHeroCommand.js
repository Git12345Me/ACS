/**
 * Command 528 - SpeedUpHeroUpgrade (kept under its historical ACS file name, like 504 which is
 * LogicBuyBuildingCommand = SpeedUpConstruction)
 * Layout: INT gameObjectId (the hero altar), INT tick
 *
 * The client's "upgrade now" flow for a hero is 527 (UpgradeHero) followed by 528, exactly as it is
 * 502 + 504 for buildings. With 528 a no-op the upgrade stayed pending and every later 527 was
 * rejected as "already upgrading". This finishes the pending hero upgrade immediately and charges
 * gems for the time still remaining (same curve as LogicBuyBuildingCommand).
 *
 * Nothing pending on the altar -> ignored (returns -1), so a stray 528 never costs gems.
 */
const Utils = require('../../../Utilities/Utils')
const { nowSeconds, finishNow } = require('../../../Core/ConstructionUtils')

const HERO_ALTARS = new Set([1000022, 1000025]) // Barbarian King, Archer Queen

// Standard CoC time -> gems curve (identical to LogicBuyBuildingCommand).
function speedUpCost (seconds) {
  if (seconds <= 0) return 0
  if (seconds <= 60) return 1
  if (seconds <= 3600) return Math.floor((seconds - 60) * 19 / 3540 + 1)
  if (seconds <= 86400) return Math.floor((seconds - 3600) * 240 / 82800 + 20)
  return Math.floor((seconds - 86400) * 740 / 518400 + 260)
}

class LogicBuyHeroCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 528
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[SpeedUpHeroUpgrade] ${msg}`) }
    if (!player) return -1

    let village
    try { village = JSON.parse(player.village) } catch (e) { return -1 }

    const id = this.data.BuildingID
    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    if (!item) return log(`building ${id} not found`), -1
    if (!HERO_ALTARS.has(item.data)) return log(`building ${id} (${item.data}) is not a hero altar`), -1

    const end = item.upgradeTime
    if (!end) return log(`altar ${id} has no hero upgrade running`), -1

    const cost = speedUpCost(end - nowSeconds())
    if ((player.diamonds || 0) < cost) return log(`not enough gems (${player.diamonds} < ${cost})`), -1
    player.diamonds = (player.diamonds || 0) - cost
    player.markModified('diamonds')

    finishNow(item, player) // lvl + 1, clears upgradeTime, awards upgradeXp
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`altar ${id} finished for ${cost} gems -> level ${(item.lvl || 0) + 1}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicBuyHeroCommand
