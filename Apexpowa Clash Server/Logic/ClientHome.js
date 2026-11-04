const fs = require('fs')
const LogicBase = require('./LogicBase')
const { resolvePendingConstruction, nowSeconds } = require('../Core/ConstructionUtils')
const LogicUpgradeUnitCommand = require('../Protocol/Commands/Client/LogicUpgradeUnitCommand')
const { applyHeroFormat } = require('../Core/HeroVillage')
const TrainingQueue = require('../Core/TrainingQueue')
const ResourceProduction = require('../Core/ResourceProduction')
const Obstacles = require('../Core/Obstacles')

const startingHome = JSON.parse(fs.readFileSync('Gamefiles/level/starting_home.json', 'utf8'))
const goblinHome = JSON.parse(fs.readFileSync('Gamefiles/level/tutorial_npc.json', 'utf8'))

class ClientHome {
  /**
   * Finishes constructions whose timer has elapsed (persisting the result) and
   * returns the village JSON to send, with `const_t` (seconds remaining) set on
   * anything still under construction so the client shows the timer.
   */
  static prepareVillage (player) {
    try {
      const village = JSON.parse(player.village)
      const buildings = resolvePendingConstruction(village, player).changed
      const units = LogicUpgradeUnitCommand.resolveUnitUpgrades(village).changed
      const training = TrainingQueue.resolveVillage(village, player) // finished troops join the army
      const production = ResourceProduction.decorate(village) // collectors: start their clock the first time
      const cleared = Obstacles.resolveClearing(village, player) // finished clearings: loot, obstacle removed
      const spawned = Obstacles.respawn(village) // new obstacles after OBSTACLE_RESPAWN_SECONDS
      if (buildings || units || training || production || cleared || spawned) {
        player.village = JSON.stringify(village)
        player.markModified('village')
        player.save()
      }
      const now = nowSeconds()
      for (const key of ['buildings', 'traps']) {
        if (!Array.isArray(village[key])) continue
        for (const item of village[key]) {
          const end = item && (item.upgradeTime || item.buildTime)
          if (end && end > now) item.const_t = end - now
        }
      }
      for (const b of village.buildings || []) { // laboratory research, in the shape the game reads (laboratory research v3)
        const up = b && b.unit_upg
        if (up && up.end) { const idx = up.id !== undefined ? up.id : up.unit_type; b.unit_upg = { unit_type: up.spell ? 1 : 0, id: (up.spell ? 26000000 : 4000000) + Number(idx), t: Math.max(1, up.end - now) } }
      }
      Obstacles.decorate(village, now) // obstacles being cleared: clear_t = seconds left
      TrainingQueue.decorate(village, now) // barracks: seconds left of the unit in training
      applyHeroFormat(village, now) // hero altars: lvl 0 + hero_upg, as the client expects
      try { // DEBUG: hero altar entries as sent
        const altars = village.buildings.filter(b => b && (b.data === 1000022 || b.data === 1000025))
        console.log('[Home] hero altars sent: ' + JSON.stringify(altars))
      } catch (e) {}
      return JSON.stringify(village)
    } catch (e) {
      console.log('[Home] could not prepare the village of ' + (player && player.name) + ': ' + (e && e.stack || e))
      try { const v = JSON.parse(player.village); for (const b of v.buildings || []) { if (b) delete b.collectedAt }; delete v.alliance_units; delete v.layouts; return JSON.stringify(v) } catch (e2) {}
      return player.village
    }
  }

  async encode (self, player, type, levelID) {
    switch (type) {
      case 0: // Normal
        new LogicBase().encode(self)
        self.writeLong(player.highID, player.lowID) // HighID, LowID
        if (player.village == '') {
          player.village = JSON.stringify(startingHome)
          self.writeString(player.village)
          player.markModified('village') // HomeJSON
          //self.client.log('Created a new village!')
        }
        else {
          self.writeString(ClientHome.prepareVillage(player)) // HomeJSON
          //self.client.log('Loaded village!')
        }
        if (player.highID === self.client.player.highID && player.lowID === self.client.player.lowID) {
          // Shield end is saved in epoch seconds (an old millisecond value is still understood).
          const shieldEnd = Number(player.shieldDurationSeconds) || 0
          const shieldDurationSeconds = Math.max(0, Math.floor((shieldEnd > 1e11 ? shieldEnd / 1000 : shieldEnd) - Date.now() / 1000))
          self.writeInt(shieldDurationSeconds) // ShieldDurationSeconds
          player.markModified('shieldDurationSeconds')
          player.save()
        } else {
          self.writeInt(0) // ShieldDurationSeconds
        }
        self.writeInt(player.guardDurationSeconds) // GuardDurationSeconds
        self.writeInt(player.personalDurationSeconds) // PersonalDurationSeconds
        break

      case 1: // Goblin
        new LogicBase().encode(self)
        self.writeLong(0, 0) // HighID, LowID
        self.writeString(JSON.stringify(require('../Core/Npcs').home(levelID) || goblinHome)) // HomeJSON (the NPC's own level file)
        self.writeInt(0) // ShieldDurationSeconds
        self.writeInt(0) // GuardDurationSeconds
        self.writeInt(0) // PersonalDurationSeconds
        break
    }
  }
}

module.exports = ClientHome