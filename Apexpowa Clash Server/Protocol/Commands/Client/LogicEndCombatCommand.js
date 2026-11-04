const LeagueUtils = require('../../../Utilities/LeagueUtils')
const { storageCapacity } = require('../../../Core/ResourceProduction')

// Attack result for a normal (non-war) battle. The game simulates the fight itself and this server
// does not know the destruction percentage, so: no troop deployed = surrender (nothing changes),
// otherwise the attacker takes Attack.lootPercent of the enemy's gold / elixir / dark elixir
// (limited by his storage room) and trophies move between both players.
// Tune with config.json "Attack": { "lootPercent": 50, "winTrophies": 20 }.
function cfg () {
  let a = {}
  try { a = require('../../../config.json').Attack || {} } catch (e) {}
  return { lootPercent: a.lootPercent ?? 50, winTrophies: a.winTrophies ?? 20, fixedTrophies: a.winTrophies !== undefined, kFactor: a.kFactor ?? 40, ticksPerSecond: a.ticksPerSecond ?? 20 }
}

class LogicEndCombatCommand {
  async decode (self) {
    try { this.rest = Buffer.from(self.buffer).slice(self.offset).toString('hex').slice(0, 80) } catch (e) { this.rest = '' }
    try { this.endTick = self.readInt() } catch (e) { this.endTick = 0 }
  }

  async process (self) {
    const WarManager = require('../../../Core/WarManager')
    const client = self.client
    try { require('../../../Core/LiveReplay').end(client) } catch (e) {}
    if (client.warAttack) { // a clan war attack ends here instead of a normal battle
      await WarManager.finishAttack(client, this.endTick)
      return
    }
    await LogicEndCombatCommand.finish(client, this.rest, this.endTick)
  }

  static async finish (client, rest, endTick) {
    const player = client.player
    const enemy = client.attackEnemy
    const deployed = client.attackDeployed
    client.attackEnemy = null
    client.attackDeployed = false
    console.log(`[Logic] battle: ended, troops deployed: ${deployed}, enemy: ${enemy ? enemy.name : 'none (npc)'}, extra bytes: ${rest || 'none'}`)
    if (!deployed || !enemy) return

    const c = cfg()
    const attackerBefore = player.trophies || 0
    const defenderBefore = enemy.trophies || 0
    const available = { gold: enemy.gold || 0, mana: enemy.mana || 0, dark: enemy.darkMana || 0 }
    const battleEvents = client.battleEvents || []
    let village = {}
    try { village = JSON.parse(player.village) } catch (e) {}
    let enemyVillage = {}
    try { enemyVillage = JSON.parse(enemy.village) } catch (e) {}

    // Replay the battle on the server: destruction %, stars, Town Hall.
    const BattleSim = require('../../../Core/BattleSim')
    const lvOf = id => { try { return Number(village.unit_levels?.[id % 1000000]) || 0 } catch (e) { return 0 } }
    const heroLv = id => { const altar = (village.buildings || []).find(b => b && b.data === (id === 28000000 ? 1000022 : 1000025)); return altar ? (altar.lvl || 0) : 0 }
    const sim = BattleSim.simulate(enemyVillage, client.battleEvents || [], endTick || 0, { unit: lvOf, hero: heroLv }, { ticksPerSecond: c.ticksPerSecond })
    // the end tick is unknown when the battle ends with Go Home: start of the first placement + simulated time
    if (!endTick) { const t0 = Math.min(...battleEvents.map(e => e.tick || 0), Infinity); endTick = Number.isFinite(t0) ? t0 + sim.ticks : 0 }
    client.battleEvents = []
    console.log('[Logic] battle levels:', JSON.stringify(battleEvents.map(e => [e.id, e.type === 'hero' ? heroLv(e.id) : lvOf(e.id)])), 'unit_levels keys:', Object.keys(village.unit_levels || {}).length)
    const stars = sim.stars
    const win = stars > 0
    console.log(`[Logic] battle: simulated ${sim.percent}% (${sim.destroyed}/${sim.total} buildings), ${stars} star(s), town hall ${sim.townHall ? 'destroyed' : 'standing'}, ${sim.ticks} ticks`)

    // Loot: share of what the enemy has, by destruction, limited by the attacker's storage room.
    const caps = storageCapacity(village)
    // LOOT_MULTIPLIER_BY_TH_DIFF (globals.csv): the higher the attacker's Town Hall is above the defender's, the less loot.
    const thLevel = v => { const th = (v.buildings || []).find(b => b && b.data === 1000001); return th ? (th.lvl || 0) + 1 : 1 }
    const thTable = require('../../../Core/Globals').array('LOOT_MULTIPLIER_BY_TH_DIFF', [100, 100, 100, 100, 100, 90, 50, 25, 5])
    const thDiff = Math.max(0, thLevel(village) - thLevel(enemyVillage))
    const thMult = (thTable[Math.min(thDiff, thTable.length - 1)] ?? 100) / 100
    const frac = sim.percent / 100 * c.lootPercent / 100 * thMult
    // The game does not clamp loot when the attacker is already over his storage cap (accounts with cheated resources),
    // so only limit it by the room left while the storage is not full yet.
    const take = (have, room) => { const v = Math.floor((have || 0) * frac); return room <= 0 ? v : Math.min(v, room) }
    const gold = take(enemy.gold, caps.gold - (player.gold || 0))
    const mana = take(enemy.mana, caps.mana - (player.mana || 0))
    // Dark Elixir can only be stolen from a base that has a Dark Elixir building (config Attack.darkLootBuildings).
    let darkIds = [1000023, 1000024, 1000026]
    try { const d = require('../../../config.json').Attack?.darkLootBuildings; if (Array.isArray(d)) darkIds = d } catch (e) {}
    const hasDark = (enemyVillage.buildings || []).some(b => b && darkIds.includes(b.data))
    const dark = hasDark ? take(enemy.darkMana, 0) : 0
    console.log(`[Logic] battle: enemy had ${enemy.gold} gold, ${enemy.mana} elixir, ${enemy.darkMana} dark elixir, ${enemy.trophies} trophies; you had ${player.trophies}; dark elixir building in base: ${hasDark}; caps ${caps.gold}/${caps.mana}; town hall difference ${thDiff} -> loot x${thMult}`)
    player.gold = (player.gold || 0) + gold
    player.mana = (player.mana || 0) + mana
    player.darkMana = (player.darkMana || 0) + dark
    enemy.gold = Math.max(0, (enemy.gold || 0) - gold)
    enemy.mana = Math.max(0, (enemy.mana || 0) - mana)
    enemy.darkMana = Math.max(0, (enemy.darkMana || 0) - dark)

    // Trophies (Elo on the trophy difference, K = Attack.kFactor). 3 stars = full gain, fewer stars less,
    // no star = a loss. Calibrated on: +58 trophies stronger, 1 star -> 8 trophies.
    const expected = 1 / (1 + Math.pow(10, ((enemy.trophies || 0) - (player.trophies || 0)) / 400))
    const full = Math.max(1, Math.round(c.kFactor * (1 - expected)))
    const share = [0, 0.47, 0.73, 1][stars]
    let t = win ? Math.max(1, Math.round(full * share)) : -Math.max(1, Math.round(c.kFactor * expected * 0.5))
    if (c.fixedTrophies && win) t = c.winTrophies
    if (win) { // league win bonus (Legend league >= 3200 trophies: 120000 / 120000 / 800)
      let bonus = { gold: 0, mana: 0, dark: 0 }
      if ((player.trophies || 0) >= 3200) bonus = { gold: 120000, mana: 120000, dark: 800 }
      try { const b = require('../../../config.json').Attack?.leagueBonus; if (b) bonus = b } catch (e) {}
      player.gold += Math.min(bonus.gold, Math.max(0, caps.gold - player.gold))
      player.mana += Math.min(bonus.mana, Math.max(0, caps.mana - player.mana))
      player.darkMana += bonus.dark
    }
    player.trophies = Math.max(0, (player.trophies || 0) + t)
    enemy.trophies = Math.max(0, (enemy.trophies || 0) - t)
    if (player.trophies > (player.highestTrophies || 0)) { player.highestTrophies = player.trophies; player.markModified('highestTrophies') }
    player.league = LeagueUtils.getLeagueByScore(player.trophies)
    if (win) { player.attackWinCount = (player.attackWinCount || 0) + 1; enemy.defendLoseCount = (enemy.defendLoseCount || 0) + 1 } else { player.attackLoseCount = (player.attackLoseCount || 0) + 1; enemy.defendWinCount = (enemy.defendWinCount || 0) + 1 }
    for (const k of ['gold', 'mana', 'darkMana', 'trophies', 'league', 'attackWinCount']) player.markModified(k)

    console.log(`[Logic] battle: looted ${gold} gold, ${mana} elixir, ${dark} dark elixir, ${t >= 0 ? '+' : ''}${t} trophies (now ${player.trophies}, enemy had ${enemy.trophies + t}) from ${enemy.name}`)
    try {
      await require('../../../Core/Replays').recordBattle({ attacker: player, defender: enemy, enemyVillage, events: battleEvents.map(e => ({ ...e, level: e.castle ? e.level : (e.type === 'hero' ? heroLv(e.id) : lvOf(e.id)) })), endTick, sim, loot: { gold, mana, dark }, available, attackerBefore, defenderBefore })
    } catch (e) { console.error('[Logic] replay: could not record the battle', e) }
    await player.save()
    try { if (typeof enemy.save === 'function') await enemy.save(); else await client.mongoose.savePlayer(enemy) } catch (e) { console.error(e) }
  }
}

module.exports = LogicEndCombatCommand
