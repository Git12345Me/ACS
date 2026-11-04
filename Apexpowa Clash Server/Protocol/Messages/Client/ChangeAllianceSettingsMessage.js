const PiranhaMessage = require('../../PiranhaMessage')
const AllianceDataMessage = require('../Server/AllianceDataMessage')

class ChangeAllianceSettingsMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14316
    this.version = 1
  }

  async decode () {
    // Read every int that is left and map them by what the first one looks like. The game sends
    // the badge (a data id, 13000000 + n) first; an older layout had one extra int before it.
    this.data = {}
    this.data.Description = this.readString()
    const ints = []
    while (this.offset + 4 <= this.buffer.length) ints.push(this.readInt())
    this.data.Raw = ints

    const first = ints.length > 0 && ints[0] >= 13000000 ? 0 : 1
    this.data.Badge = ints[first]
    this.data.Type = ints[first + 1]
    this.data.RequiredTrophies = ints[first + 2]
    this.data.WarFrequency = ints[first + 3]
    this.data.Location = ints[first + 4]
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose
    const clanId = player && player.clan

    if (!player || !player.inClan || !clanId) return

    const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback)

    try {
      const clan = await db.getClanByID(clanId.ClanHighID, clanId.ClanLowID)
      if (!clan) return
      const actor = (clan.members || []).find(member =>
        member.highID === player.highID && member.lowID === player.lowID
      )
      // Roles: 1 = Member, 2 = Leader, 3 = Elder, 4 = Co-Leader.
      // Use the persisted roster to avoid trusting a stale client role.
      if (!actor || (actor.role !== 2 && actor.role !== 4)) return
      player.clan.ClanRole = actor.role

      // Values come straight from the client, so keep them in range before saving.
      const type = int(this.data.Type)
      if (this.data.WarFrequency !== undefined) clan.warFrequency = Math.max(0, int(this.data.WarFrequency))

      this.client.log(`[Clan] settings change: ints=${JSON.stringify(this.data.Raw)}`)

      // updateClanSettings saves the whole clan, warFrequency included, in one write.
      await db.updateClanSettings(clan, {
        description: String(this.data.Description || '').slice(0, 128),
        badge: int(this.data.Badge, clan.badge),
        type: type >= 1 && type <= 3 ? type : clan.type, // 1 = anyone, 2 = invite only, 3 = closed
        requiredTrophies: Math.max(0, int(this.data.RequiredTrophies)),
        location: int(this.data.Location, clan.location)
      })
      // Send the clan back so the open screens show the new settings.
      await new AllianceDataMessage(this.client, [clanId.ClanHighID, clanId.ClanLowID]).send()
      // Server command 6 to every online clan member (the editor included): their game updates the clan badge / level.
      try {
        const AvailableServerCommandMessage = require('../Server/AvailableServerCommandMessage')
        const PlayerManager = require('../../../Core/PlayerManager')
        for (const c of PlayerManager.getAll()) {
          const p = c.player
          if (p && p.inClan && p.clan && p.clan.ClanHighID === clanId.ClanHighID && p.clan.ClanLowID === clanId.ClanLowID) {
            await new AvailableServerCommandMessage(c, 6).send()
          }
        }
      } catch (e) { console.log('[Clan] could not send the settings command:', e.message) }
    } catch (error) {
      console.error('Unable to change alliance settings:', error)
    }
  }
}

module.exports = ChangeAllianceSettingsMessage
