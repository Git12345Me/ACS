
const { addExperience } = require('./ExperienceUtils')

const nowSeconds = () => Math.floor(Date.now() / 1000)

// Immediately applies a pending timer's effect, regardless of whether it
// has actually elapsed yet. Used by the explicit "speed up" command.
// Returns true if the item had something pending to finish.
function finishNow (item, player) {
  if (!item) return false
  let changed = false

  // The finished timer fields are removed, not set to 0: a "0" left in the village JSON (and const_t) is
  // sent to the client, which reads it as a construction that never ends - the town hall then crashes it.
  if (item.upgradeTime) {
    item.lvl = (item.lvl || 0) + 1
    delete item.upgradeTime
    delete item.const_t
    changed = true
  }
  if (item.buildTime) {
    delete item.buildTime
    delete item.const_t
    changed = true
  }

  // XP for the finished upgrade (stored by LogicUpgradeBuildingCommand when it started)
  if (changed && item.upgradeXp && player) {
    addExperience(player, item.upgradeXp)
    delete item.upgradeXp
  }

  return changed
}

// Walks buildings/traps and finishes any timer whose completion time has
// already passed. Call this before sending a village to a client so
// completed work shows up next time the player looks at their base.
// Returns { village, changed } -- callers should only persist when changed.
function resolvePendingConstruction (village, player) {
  const now = nowSeconds()
  let changed = false

  for (const key of ['buildings', 'traps']) {
    const list = village[key]
    if (!Array.isArray(list)) continue

    for (const item of list) {
      if (!item) continue
      const pending = item.buildTime || item.upgradeTime
      if (pending && pending <= now) {
        if (finishNow(item, player)) changed = true
      }
    }
  }

  return { village, changed }
}

module.exports = { nowSeconds, finishNow, resolvePendingConstruction }
