/**
 * Command 504 - SpeedUpConstruction (kept under its historical ACS file name)
 * Layout: INT gameObjectId, INT tick
 *
 * Finishes a pending upgrade/construction immediately and charges gems based
 * on the time that was still remaining.
 */
const Utils = require('../../../Utilities/Utils')
const { nowSeconds, finishNow } = require('../../../Core/ConstructionUtils')

const CLASS_TO_LIST = { 500: 'buildings', 504: 'traps' }

// Standard CoC time -> gems curve.
function speedUpCost (seconds) {
  if (seconds <= 0) return 0
  if (seconds <= 60) return 1
  if (seconds <= 3600) return Math.floor((seconds - 60) * 19 / 3540 + 1)
  if (seconds <= 86400) return Math.floor((seconds - 3600) * 240 / 82800 + 20)
  return Math.floor((seconds - 86400) * 740 / 518400 + 260)
}

class LogicBuyBuildingCommand {
  constructor (client = null) {
    this.client = client
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.Tick = self.readInt()
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => {
      if (client && typeof client.log === 'function') client.log(`[SpeedUpConstruction] ${msg}`)
    }
    if (!player) return -1

    const id = this.data.BuildingID
    const list = CLASS_TO_LIST[Utils.getClassID(id)]
    if (!list) return log(`unsupported object class for id ${id}`), -1

    let village
    try { village = JSON.parse(player.village) } catch (e) { return -1 }
    const item = Array.isArray(village[list]) ? village[list][Utils.getInstanceID(id)] : null
    if (!item) return log(`object ${id} not found`), -1

    const end = item.upgradeTime || item.buildTime
    if (!end) return log(`object ${id} has nothing under construction`), -1

    const cost = speedUpCost(end - nowSeconds())
    if ((player.diamonds || 0) < cost) return log(`not enough gems (${player.diamonds} < ${cost})`), -1
    player.diamonds = (player.diamonds || 0) - cost
    player.markModified('diamonds')

    finishNow(item, player)
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`object ${id} finished for ${cost} gems (level ${player.level}, xp ${player.xpPoints})`)
    return 0
  }
}

module.exports = LogicBuyBuildingCommand
