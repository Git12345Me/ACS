/**
 * Command 526 - BoostBuilding: spend gems to boost a gold mine / elixir pump (the game's "Boost" button).
 *
 * Layout (from live client traffic): INT buildingId, INT tick
 *   e.g. 1d cd 65 0b | 00 00 00 b2 = building 500000011, tick 178
 *
 * The collector then produces Core/ResourceProduction.BOOST_MULTIPLIER (10) times as much for BOOST_HOURS (24) hours: `boostStart` /
 * `boostEnd` are saved on the building, ResourceProduction counts the time inside the boost multiplied and sends `boost_t` (seconds of
 * boost left) to the game. Not boostable: anything that produces no resource, a building under construction or upgrade, one that is
 * already boosted.
 *
 * Gem cost: the client works it out from the resources the boost adds ("boost resource gem cost: ... (extra res ...)"), which the
 * server does not have, so the classic resource -> gems table is used on that extra amount (the same table the game uses to sell
 * resources: 100 = 1, 1,000 = 5, 10,000 = 25, 100,000 = 125, 1,000,000 = 600, 10,000,000 = 3,000 gems, in between linear).
 * It may differ from what the game took from the player's gems. When the player has too few gems the boost is refused.
 */
const Utils = require('../../../Utilities/Utils')
const { nowSeconds } = require('../../../Core/ConstructionUtils')
const RP = require('../../../Core/ResourceProduction')

const GEM_TABLE = [[100, 1], [1000, 5], [10000, 25], [100000, 125], [1000000, 600], [10000000, 3000]]

function gemsForResources (amount) {
  if (amount <= 0) return 0
  if (amount <= GEM_TABLE[0][0]) return 1
  for (let i = 1; i < GEM_TABLE.length; i++) {
    const [a1, g1] = GEM_TABLE[i - 1]
    const [a2, g2] = GEM_TABLE[i]
    if (amount <= a2) return Math.max(1, Math.floor(g1 + (amount - a1) * (g2 - g1) / (a2 - a1)))
  }
  return Math.floor(amount * 3000 / 10000000)
}

class LogicBoostBuildingCommand {
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
    return 526
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (text) => { if (client && typeof client.log === 'function') client.log(`[LogicBoostBuildingCommand] ${text}`) }
    if (!player) return -1

    const id = this.data.BuildingID
    if (Utils.getClassID(id) !== 500) return log(`unsupported object class for id ${id}`), -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    if (!item) return log(`building ${id} not found`), -1
    const prod = RP.productionOf(item)
    if (!prod) return log(`building ${id} (${item.data}) cannot be boosted`), -1
    const now = nowSeconds()
    if (item.buildTime > now || item.upgradeTime > now) return log(`building ${id} is under construction`), -1
    if (RP.isBoosted(item, now)) return log(`building ${id} is already boosted`), -1

    const extra = Math.floor(prod.perHour * (RP.BOOST_MULTIPLIER - 1) * RP.BOOST_HOURS)
    const cost = gemsForResources(extra)
    if ((player.diamonds || 0) < cost) return log(`not enough gems (${player.diamonds} < ${cost})`), -1
    player.diamonds = (player.diamonds || 0) - cost
    player.markModified('diamonds')

    if (!item.collectedAt) item.collectedAt = now
    item.boostStart = now
    item.boostEnd = now + RP.BOOST_HOURS * 3600

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`${prod.resource} building ${id} boosted x${RP.BOOST_MULTIPLIER} for ${RP.BOOST_HOURS} h (${cost} gems)`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicBoostBuildingCommand
module.exports.gemsForResources = gemsForResources
