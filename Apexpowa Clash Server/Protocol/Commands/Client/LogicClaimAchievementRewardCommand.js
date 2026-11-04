const AchievementData = require('../../../Core/AchievementData')
const fs = require('fs')
const path = require('path')

// Experience needed to leave each level (experience_levels.csv: Level,ExpPoints).
let expForLevel = []
try {
  expForLevel = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Gamefiles', 'csv', 'experience_levels.csv'), 'utf8')
    .replace(/\r/g, '').split('\n').slice(2)
    .map(l => l.split(','))
    .filter(c => c[0] && Number.isFinite(parseInt(c[1], 10)))
    .map(c => parseInt(c[1], 10))
} catch (err) {
  expForLevel = []
}

// Logic command 523. Payload: INT achievementID, INT tick.
class LogicClaimAchievementRewardCommand {
  async decode (self) {
    this.data = {
      AchievementID: self.readInt(),
      Unknown: self.readInt()
    }
  }

  async process (self) {
    const player = self && self.client && self.client.player
    if (!player) return

    const id = Number(this.data && this.data.AchievementID)
    const info = AchievementData.get(id)
    if (!info) {
      self.client.log(`[LogicClaimAchievementRewardCommand] unknown achievement ${id}`)
      return
    }

    if (!Array.isArray(player.achievements)) player.achievements = []
    let entry = player.achievements.find(a => a && Number(a.id) === id)
    if (entry && entry.claimed) return // already claimed, never pay twice

    if (!entry) {
      entry = { id, value: 0, claimed: false }
      player.achievements.push(entry)
    }
    // The command carries no progress, so a claim means the target was reached.
    entry.value = Math.max(Number(entry.value) || 0, info.actionCount)
    entry.claimed = true

    player.diamonds = (Number(player.diamonds) || 0) + info.diamondReward

    // Same level-up rule the client applies: XP is the remainder inside a level.
    let level = Number(player.level) || 1
    let xp = (Number(player.xpPoints) || 0) + info.expReward
    while (level <= expForLevel.length && xp >= expForLevel[level - 1]) {
      xp -= expForLevel[level - 1]
      level++
    }
    player.level = level
    player.xpPoints = xp

    self.client.log(`[LogicClaimAchievementRewardCommand] ${info.name}: +${info.diamondReward} gems, +${info.expReward} xp`)

    if (typeof player.markModified === 'function') player.markModified('achievements')
    if (typeof player.save === 'function') await player.save()
  }
}

module.exports = LogicClaimAchievementRewardCommand
