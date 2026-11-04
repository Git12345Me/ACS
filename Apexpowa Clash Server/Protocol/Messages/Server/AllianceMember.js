const writeMemberEntry = require('./AllianceMemberEntryWriter')

// Writes one member of the clan member list. The field layout lives in
// Logic/AllianceMemberEntry.js (ClanMembers in the coc-messages schema).
class AllianceMember {
  constructor (player = null, role = 0) {
    this.player = player
    this.role = role
  }

  encode (message) {
    const player = this.player || {}
    writeMemberEntry(message, {
      highID: player.highID,
      lowID: player.lowID,
      name: player.name,
      role: this.role || player.role,
      level: player.level,
      league: player.league,
      trophies: player.trophies,
      donated: player.donated,
      donationsReceived: player.donationsReceived,
      joinedAt: player.joinedAt,
      warCooldown: player.warCooldown,
      warCooldownEnd: player.warCooldownEnd,
      warPreference: player.warPreference,
      secondaryString: player.secondaryString
    }, 1, 1)
  }
}

module.exports = AllianceMember
