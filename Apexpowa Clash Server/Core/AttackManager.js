// Normal player-vs-player attack settlement.
//
// ACS does not simulate battles or receive authoritative stars/destruction in
// LogicEndCombatCommand. This manager therefore uses a small configurable
// completion payout after at least one troop was deployed. It is deliberately
// separate from clan-war settlement in WarManager.
const config = require('../config.json')
const ResourceProduction = require('./ResourceProduction')
const LeagueUtils = require('../Utilities/LeagueUtils')
const PlayerManager = require('./PlayerManager')

const attackConfig = config.Attack || {}
const configuredLootPercent = Number(attackConfig.LootPercent)
const configuredTrophyTransfer = Number(attackConfig.TrophyTransfer)
const LOOT_PERCENT = Number.isFinite(configuredLootPercent)
  ? Math.max(0, Math.min(100, configuredLootPercent))
  : 10
const TROPHY_TRANSFER = Number.isFinite(configuredTrophyTransfer)
  ? Math.max(0, Math.floor(configuredTrophyTransfer))
  : 30

function beginPlayerAttack (client, defender) {
  if (!client || !client.player || !defender) return null
  const attack = {
    defenderHighID: Number(defender.highID) || 0,
    defenderLowID: Number(defender.lowID) || 0,
    defenderName: String(defender.name || ''),
    started: false,
    settling: false,
    startedAt: Date.now()
  }
  client.normalAttack = attack
  client.battleKind = 'player'
  client.shieldBreakHandled = false
  return attack
}

function readVillage (player) {
  try {
    return typeof player.village === 'string' ? JSON.parse(player.village) : player.village
  } catch (e) {
    return null
  }
}

function mark (player, fields) {
  if (typeof player.markModified !== 'function') return
  for (const field of fields) player.markModified(field)
}

function clearAttack (client) {
  client.normalAttack = null
  if (client.battleKind === 'player') client.battleKind = null
}

async function finishPlayerAttack (client, source = 'combat-end') {
  const attack = client && client.normalAttack
  if (!attack || attack.settling) return { settled: false, reason: 'no active player attack' }

  // Do not award anything for opening an opponent's village and returning
  // without deploying a troop.
  if (!attack.started) {
    clearAttack(client)
    if (client.log) client.log('[Attack] player attack ended before troop deployment; no payout')
    return { settled: false, reason: 'no troops deployed' }
  }

  attack.settling = true
  try {
    const attacker = client.player
    const db = client.mongoose
    if (!attacker || !db || typeof db.getPlayerByID !== 'function') {
      throw new Error('player database lookup is unavailable')
    }

    const onlineDefenders = typeof PlayerManager.getAll === 'function'
      ? [...PlayerManager.getAll()].filter(connection =>
          connection.player &&
          Number(connection.player.highID) === attack.defenderHighID &&
          Number(connection.player.lowID) === attack.defenderLowID)
      : []
    const defender = onlineDefenders.length > 0
      ? onlineDefenders[0].player
      : await db.getPlayerByID(attack.defenderHighID, attack.defenderLowID)
    if (!defender) {
      clearAttack(client)
      if (client.log) client.log('[Attack] opponent no longer exists; no payout')
      return { settled: false, reason: 'opponent not found' }
    }
    if (Number(defender.highID) === Number(attacker.highID) &&
        Number(defender.lowID) === Number(attacker.lowID)) {
      clearAttack(client)
      if (client.log) client.log('[Attack] self-target refused; no payout')
      return { settled: false, reason: 'self target' }
    }

    const village = readVillage(attacker)
    const caps = village ? ResourceProduction.storageCapacity(village) : { gold: 0, mana: 0 }
    const loot = { gold: 0, mana: 0 }

    for (const [field, capField] of [['gold', 'gold'], ['mana', 'mana']]) {
      const defenderAmount = Math.max(0, Number(defender[field]) || 0)
      const attackerAmount = Math.max(0, Number(attacker[field]) || 0)
      const room = Math.max(0, (Number(caps[capField]) || 0) - attackerAmount)
      const offered = Math.floor(defenderAmount * LOOT_PERCENT / 100)
      loot[field] = Math.min(offered, room)
      attacker[field] = attackerAmount + loot[field]
      defender[field] = defenderAmount - loot[field]
    }

    // The v6 ACS command does not report a verified star/destruction result.
    // This approximate configuration transfers a fixed trophy amount instead
    // of pretending to calculate the game's full trophy formula.
    const defenderTrophies = Math.max(0, Number(defender.trophies) || 0)
    const trophyDelta = Math.min(TROPHY_TRANSFER, defenderTrophies)
    attacker.trophies = (Number(attacker.trophies) || 0) + trophyDelta
    defender.trophies = defenderTrophies - trophyDelta
    attacker.highestTrophies = Math.max(Number(attacker.highestTrophies) || 0, attacker.trophies)
    attacker.league = LeagueUtils.getLeagueByScore(attacker.trophies)
    defender.league = LeagueUtils.getLeagueByScore(defender.trophies)
    attacker.attackWinCount = (Number(attacker.attackWinCount) || 0) + 1
    defender.attackLoseCount = (Number(defender.attackLoseCount) || 0) + 1

    mark(attacker, ['gold', 'mana', 'trophies', 'highestTrophies', 'league', 'attackWinCount'])
    mark(defender, ['gold', 'mana', 'trophies', 'league', 'attackLoseCount'])
    // Keep every open session for this defender in sync, otherwise an older
    // in-memory player object could later overwrite the debit on its next save.
    const defenderFields = ['gold', 'mana', 'trophies', 'league', 'attackLoseCount']
    const synchronized = new Set([defender])
    for (const connection of onlineDefenders) {
      const onlinePlayer = connection.player
      if (synchronized.has(onlinePlayer)) continue
      synchronized.add(onlinePlayer)
      for (const field of defenderFields) onlinePlayer[field] = defender[field]
      mark(onlinePlayer, defenderFields)
      if (typeof onlinePlayer.save === 'function') await onlinePlayer.save()
    }
    if (typeof attacker.save === 'function') await attacker.save()
    if (typeof defender.save === 'function') await defender.save()

    clearAttack(client)
    if (client.log) {
      client.log(
        `[Attack] approximate settlement (${source}) vs ${attack.defenderName || `${attack.defenderHighID}-${attack.defenderLowID}`}: ` +
        `+${trophyDelta} trophies, +${loot.gold} gold, +${loot.mana} elixir; ` +
        `${LOOT_PERCENT}% loot setting, capped by attacker's storage`
      )
    }
    return { settled: true, trophyDelta, loot, defender }
  } catch (error) {
    attack.settling = false
    throw error
  }
}

function cancelPlayerAttack (client) {
  if (!client || !client.normalAttack) return false
  clearAttack(client)
  return true
}

module.exports = {
  beginPlayerAttack,
  finishPlayerAttack,
  cancelPlayerAttack,
  LOOT_PERCENT,
  TROPHY_TRANSFER
}
