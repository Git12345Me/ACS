/**
 * Command 8 - ChangeAllianceRole (C# LogicChangeAllianceRoleCommand).
 *
 * Layout (C# Decode): LONG allianceId (two INTs: high, low), INT role, INT tick.
 *
 * The C# Execute sets the avatar's role in its clan. The server sends this command to a member when their role changes and the
 * client sends it back, so the value that arrives comes from the client. ACS therefore does NOT trust the role in the command:
 * it checks that the player is in that clan and takes the role from the clan's own member list (the one the leader's
 * ChangeAllianceMemberRole message changed). A client cannot promote itself with it.
 */
class LogicChangeAllianceRoleCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    const [high, low] = self.readLong()
    this.data.AllianceHighID = high
    this.data.AllianceLowID = low
    this.data.Role = self.readInt()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 8
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const db = client && client.mongoose
    const log = (text) => { if (client && typeof client.log === 'function') client.log(`[LogicChangeAllianceRoleCommand] ${text}`) }
    if (!player || !db) return -1

    const { AllianceHighID, AllianceLowID, Role } = this.data
    if (!player.inClan || !player.clan) return log('ignored: the player is not in a clan'), 0
    if (player.clan.ClanHighID !== AllianceHighID || player.clan.ClanLowID !== AllianceLowID) {
      return log(`ignored: clan ${AllianceHighID}-${AllianceLowID} is not the player's clan ${player.clan.ClanHighID}-${player.clan.ClanLowID}`), 0
    }

    const clan = await db.getClanByID(AllianceHighID, AllianceLowID)
    const member = clan && Array.isArray(clan.members) ? clan.members.find(m => m.highID === player.highID && m.lowID === player.lowID) : null
    if (!member) return log('ignored: the player is not in the clan member list'), 0

    if (member.role !== Role) log(`client says role ${Role}, the clan says ${member.role}: using the clan's`)
    if (player.clan.ClanRole !== member.role) {
      player.clan.ClanRole = member.role
      if (typeof player.markModified === 'function') player.markModified('clan')
      if (typeof player.save === 'function') await player.save()
      log(`role is now ${member.role}`)
    }
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicChangeAllianceRoleCommand
