// Server command 6 (24111 AvailableServerCommand): the clan's settings changed. Port of the C# Changed_Alliance_Setting:
//   LONG clan id, INT badge, INT level, INT -1
// Sent to every online clan member after the Leader / Co-Leader saved new settings, so their game updates the badge.
class LogicAllianceSettingChangedCommand {
  async decode (self) {}

  async encode (self) {
    const db = self.client.mongoose
    const p = self.client.player
    const clan = await db.getClanByID(p.clan.ClanHighID, p.clan.ClanLowID)
    self.writeLong(clan.highID, clan.lowID) // clan id
    self.writeInt(clan.badge) // badge
    self.writeInt(clan.level) // level
    self.writeInt(-1)
  }
}

module.exports = LogicAllianceSettingChangedCommand
