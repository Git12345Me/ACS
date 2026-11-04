/**
 * Core/HeroVillage.js
 *
 * Converts hero altars to the village JSON format the client expects (seen in the real-server
 * capture starting_home.json.bak):
 *   {"data":1000022,"lvl":0,"x":33,"y":36,"hero_upg":{"level":15,"t":353926}}
 *   - the altar building itself is always "lvl":0; the HERO's level travels in the avatar
 *     (ClientAvatar array 7), not in the village
 *   - an upgrade in progress is "hero_upg": { level, t = seconds remaining }, not "const_t"
 *
 * ACS keeps the hero level in the altar's `lvl` and the upgrade end in `upgradeTime` (unix secs),
 * which LogicUpgradeHeroCommand / LogicBuyHeroCommand / ConstructionUtils / ClientAvatar all use.
 * So this runs ONLY on the copy of the village that is sent to the client; nothing is saved back.
 */
const HERO_ALTARS = new Set([1000022, 1000025]) // Barbarian King, Archer Queen

function applyHeroFormat (village, now) {
  if (!village || !Array.isArray(village.buildings)) return village
  for (const b of village.buildings) {
    if (!b || !HERO_ALTARS.has(b.data)) continue
    const heroLevel = b.lvl || 0
    delete b.hero_sleep // server-side state, sent through the avatar (array 9)
    delete b.const_t // an altar upgrade is not a normal construction
    if (b.upgradeTime && b.upgradeTime > now) {
      b.hero_upg = { level: heroLevel, t: b.upgradeTime - now }
    }
    b.lvl = 0 // the avatar carries the hero level
  }
  return village
}

module.exports = { applyHeroFormat }
