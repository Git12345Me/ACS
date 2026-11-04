/**
 * Command 506 - CollectResources (port of the C# LogicCollectResourcesCommand)
 * Layout: INT gameObjectId, then the base command fields (INT tick; this client may put a -1 INT in front of it).
 *
 * Execute (C#): find the object, check it is a building of the active village with a resource production component,
 * then collect its resources (CollectAllResourcesAtOnce is false in this game version, so only this collector).
 * Returns 0 ok, -1 no production component, -2 object not found / not a building, -3 other village.
 *
 * ACS: the collector holds ResourcePerHour * time since `collectedAt`, capped at ResourceMax (Core/ResourceProduction).
 * What fits into the storages is added to the player; anything that does not fit stays in the collector.
 */
const Utils = require('../../../Utilities/Utils')
const { productionOf, waiting, storageCapacity } = require('../../../Core/ResourceProduction')
const { nowSeconds } = require('../../../Core/ConstructionUtils')

class LogicCollectResourcesCommand {
  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    let next = self.readInt()
    if (next === -1 || next === 0xffffffff) next = self.readInt()
    this.data.Tick = next
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[LogicCollectResourcesCommand] ${msg}`) }
    if (!player) return -1

    const id = this.data.BuildingID
    if (Utils.getClassID(id) !== 500) return log(`object ${id} is not a building`), -2

    let village
    try { village = JSON.parse(player.village) } catch (e) { return log('player has no readable village'), -2 }

    const item = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(id)] : null
    if (!item) return log(`object ${id} not found`), -2

    const prod = productionOf(item)
    if (!prod) return log(`object ${id} (data ${item.data}) produces no resource`), -1

    const now = nowSeconds()
    const available = waiting(item, prod, now)
    if (available <= 0) return log(`object ${id}: nothing to collect yet`), 0

    // Room in the storage: dark elixir has no capacity data here, so it is not limited.
    const caps = storageCapacity(village)
    const room = prod.field === 'darkMana' ? available : Math.max(0, (caps[prod.field] || 0) - (player[prod.field] || 0))
    const taken = Math.min(available, room)
    if (taken <= 0) return log(`object ${id}: the ${prod.resource} storage is full`), 0

    player[prod.field] = (player[prod.field] || 0) + taken
    player.markModified(prod.field)
    // Collected everything -> start again from now. Part left behind -> keep that production time in the collector.
    item.collectedAt = taken >= available ? now : now - Math.floor((available - taken) * 3600 / prod.perHour)
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`object ${id}: collected ${taken} ${prod.resource}${taken < available ? ` (storage full, ${available - taken} stays in the collector)` : ''}`)
    return 0
  }

  destruct () { this.data = {} }
}

module.exports = LogicCollectResourcesCommand
