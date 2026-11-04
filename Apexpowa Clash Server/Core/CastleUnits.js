// Troops donated to a player by clan mates (the units inside their own Clan Castle).
// Stored in the player's village JSON as village.alliance_units = [{ unitID, count, level }]
// (no database column needed), and sent to the game as "array 10, alliance unit data" in ClientAvatar.
const PiranhaMessageDummy = null // (kept dependency free on purpose)

function parseVillage (player) {
  try {
    return typeof player.village === 'string' ? JSON.parse(player.village) : (player.village || {})
  } catch (e) { return {} }
}

function getUnits (player) {
  const v = parseVillage(player)
  return Array.isArray(v.alliance_units) ? v.alliance_units.filter(u => u && u.count > 0) : []
}

// housing(unitID) -> space of one unit. Returns the capacity used.
function usedCapacity (player, housing) {
  return getUnits(player).reduce((sum, u) => sum + u.count * (housing ? housing(u.unitID) : 1), 0)
}

function addUnit (player, unitID, level = 0) {
  const v = parseVillage(player)
  if (!Array.isArray(v.alliance_units)) v.alliance_units = []
  const slot = v.alliance_units.find(u => u.unitID === unitID && (u.level || 0) === level)
  if (slot) slot.count += 1
  else v.alliance_units.push({ unitID, count: 1, level })
  player.village = JSON.stringify(v)
  if (typeof player.markModified === 'function') player.markModified('village')
}

function clear (player) {
  const v = parseVillage(player)
  v.alliance_units = []
  player.village = JSON.stringify(v)
  if (typeof player.markModified === 'function') player.markModified('village')
}

// Removes up to `count` units of this type from the castle. Returns how many were removed.
function removeUnit (player, unitID, count = 1, level = null) {
  const v = parseVillage(player)
  if (!Array.isArray(v.alliance_units)) return 0
  let left = count
  let removed = 0
  for (const u of v.alliance_units) {
    if (left <= 0) break
    if (Number(u.unitID) !== Number(unitID) || !(u.count > 0)) continue
    if (level !== null && (u.level || 0) !== level) continue
    const n = Math.min(u.count, left)
    u.count -= n
    left -= n
    removed += n
  }
  v.alliance_units = v.alliance_units.filter(u => u && u.count > 0)
  if (removed > 0) {
    player.village = JSON.stringify(v)
    if (typeof player.markModified === 'function') player.markModified('village')
  }
  return removed
}

module.exports = { getUnits, addUnit, usedCapacity, clear, removeUnit }
