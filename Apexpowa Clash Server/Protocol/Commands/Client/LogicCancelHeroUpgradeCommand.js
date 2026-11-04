/**
 * Command 531 - CancelHeroUpgrade (C# LogicCancelHeroUpgradeCommand).
 *
 * Layout (C# Decode): INT gameObjectId (the hero altar building), INT tick.
 * C# Execute: the altar's HeroBaseComponent.CancelUpgrade(), -1 when the object is not a building with a hero component.
 *
 * ACS: the altar building in the village JSON (see LogicUpgradeHeroCommand). Cancelling removes its `upgradeTime`, so the hero stays
 * at its level, and gives back part of the cost that was charged when the upgrade started (the row of heroes.csv for the level
 * that was being upgraded from). The refund share is CANCEL_REFUND_PERCENT below (config.json -> Hero.CancelRefundPercent); the
 * game's own cancel multiplier is not in this server's globals.csv, so 50 is an assumption.
 */
const Utils = require('../../../Utilities/Utils')
const CSVManager = require('../../../Core/CSVManager')
const UpgradeHero = require('./LogicUpgradeHeroCommand')

let CANCEL_REFUND_PERCENT = 50
try { CANCEL_REFUND_PERCENT = Number(require('../../../config.json').Hero.CancelRefundPercent) } catch (e) { /* default */ }
if (!Number.isFinite(CANCEL_REFUND_PERCENT) || CANCEL_REFUND_PERCENT < 0 || CANCEL_REFUND_PERCENT > 100) CANCEL_REFUND_PERCENT = 50

class LogicCancelHeroUpgradeCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.GameObjectID = self.readInt()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 531
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (text) => { if (client && typeof client.log === 'function') client.log(`[LogicCancelHeroUpgradeCommand] ${text}`) }
    if (!player) return -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const id = this.data.GameObjectID
    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    const altar = item && UpgradeHero.ALTARS[item.data]
    if (!altar) return log(`object ${id} is not a hero altar`), -1
    if (!item.upgradeTime) return log(`hero ${altar.hero} is not being upgraded`), -1

    // Refund: what LogicUpgradeHeroCommand charged for this level.
    const group = UpgradeHero.loadHeroTable()[altar.hero]
    const row = group ? group[Math.min(item.lvl || 0, group.length - 1)] : null
    let refund = 0
    if (row) {
      const cost = parseInt(row.UpgradeCost, 10) || 0
      const field = CSVManager.resourceField(row.UpgradeResource) || (row.UpgradeResource === 'DarkElixir' ? 'darkMana' : null)
      if (cost > 0 && field) {
        refund = Math.floor(cost * CANCEL_REFUND_PERCENT / 100)
        player[field] = (Number(player[field]) || 0) + refund
        player.markModified(field)
      }
    }

    delete item.upgradeTime // CancelUpgrade
    delete item.upgradeXp

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`hero ${altar.hero} upgrade cancelled${refund ? `, refunded ${refund}` : ''}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicCancelHeroUpgradeCommand
