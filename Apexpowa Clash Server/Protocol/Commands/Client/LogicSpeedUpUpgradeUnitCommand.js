const Utils = require('../../../Utilities/Utils')
const { nowSeconds } = require('../../../Core/ConstructionUtils')

// Standard CoC time -> gems curve (identical to LogicBuyBuildingCommand).
function speedUpCost (seconds) {
  if (seconds <= 0) return 0
  if (seconds <= 60) return 1
  if (seconds <= 3600) return Math.floor((seconds - 60) * 19 / 3540 + 1)
  if (seconds <= 86400) return Math.floor((seconds - 3600) * 240 / 82800 + 20)
  return Math.floor((seconds - 86400) * 740 / 518400 + 260)
}

class LogicSpeedUpUpgradeUnitCommand {
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
    return 517
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => {
      if (client && typeof client.log === 'function') client.log(`[LogicSpeedUpUpgradeUnitCommand] ${msg}`)
    }
    if (!player) return -1

    const id = this.data.BuildingID
    if (Utils.getClassID(id) !== 500) return log(`unsupported object class for id ${id}`), -1

    let village
    try {
      village = JSON.parse(player.village)
    } catch (e) {
      return log('player has no readable village'), -1
    }

    const lab = Array.isArray(village.buildings) ? village.buildings[Utils.getInstanceID(id)] : null
    if (!lab) return log(`building ${id} not found`), -1

    const up = lab.unit_upg
    if (!up || !up.end) return log(`building ${id} has no unit upgrade running`), -1

    // Gems for the remaining time
    const cost = speedUpCost(up.end - nowSeconds())
    if ((Number(player.diamonds) || 0) < cost) {
      return log(`not enough gems (${player.diamonds} < ${cost})`), -1
    }
    player.diamonds = (Number(player.diamonds) || 0) - cost
    player.markModified('diamonds')

    // Finish the upgrade now
    const key = up.spell ? 'spell_levels' : 'unit_levels'
    if (!village[key] || typeof village[key] !== 'object') village[key] = {}
    const newLevel = (Number(village[key][up.unit_type]) || 0) + 1
    village[key][up.unit_type] = newLevel
    delete lab.unit_upg

    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`${up.spell ? 'spell' : 'unit'} ${(up.spell ? 26000000 : 4000000) + Number(up.unit_type)} finished -> level ${newLevel + 1} for ${cost} gems`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicSpeedUpUpgradeUnitCommand
