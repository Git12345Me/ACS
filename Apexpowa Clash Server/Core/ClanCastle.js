// Clan Castle of a player's own village: level and troop capacity.
// Level is the 0-indexed building level (same value ClientAvatar sends as AllianceCastleLevel).
// buildings.csv has Alliance Castle capacities 10/15/20/25 for the first four levels; later
// levels follow the same +5 per level pattern up to the game maximum of 50.
const CLAN_CASTLE_DATA_ID = 1000014

function capacityForLevel (level) {
  return Math.min(50, 10 + 5 * Math.max(0, level))
}

function getClanCastle (player) {
  let level = 0
  try {
    const village = typeof player.village === 'string' ? JSON.parse(player.village) : player.village
    const castle = (village?.buildings || []).find(b => b.data === CLAN_CASTLE_DATA_ID)
    if (castle) level = castle.lvl || 0
  } catch (e) {}
  return { level, totalCapacity: capacityForLevel(level), totalSpellCapacity: 0 }
}

module.exports = { getClanCastle, capacityForLevel }
