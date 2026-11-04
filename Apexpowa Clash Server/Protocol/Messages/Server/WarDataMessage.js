const PiranhaMessage = require('../../PiranhaMessage')
const Switches = require('../../../Core/Switches')
const AllianceWarMemberEntry = require('../../../Core/AllianceWarMemberEntry')

/**
 * 24335 - clan war data, in the layout THIS client decodes (libg.so: message decode @0x116A00,
 * clan entry @0x116CAC, header @0x116F0C, war member @0x117230):
 *
 *   INT   state          (1 = searching for opponents, 4 = preparation, 5 = battle, 6 = ended)
 *   INT   timeLeft       (seconds)
 *   <clan entry>
 *           LONG   id
 *           STRING name
 *           INT    badge            (data reference)
 *           INT    memberCount      <- directly after the badge: NO level / xp INTs in between
 *           <war member> x memberCount
 *   BOOL  hasOpponent    [<clan entry>]
 *   BOOL  hasWarId       [LONG warId]   (written back to back: ByteStream packs both into ONE byte)
 *   INT   commandCount   (-1 = none)
 *
 * <war member>: see Core/AllianceWarMemberEntry.js (the client's own encoder, decoder and constructor, field by
 * field). Note its warState [+0x7C]: it must be 1 (or 3) for every member, the war screen looks the current
 * player's entry up by avatar id and tests it; this message used to send 0 there.
 *
 * Your previous message wrote two extra INTs after the badge (1 and 0). The client read the 1 as
 * the member count and decoded a "member" from bytes 8 too early, which crashed it right after login.
 *
 * What is sent in the member lists (all of it can be changed without a restart, in
 * Gamefiles/clan_event_numbers.json - the file the other switches use):
 *   - state 0 ("no war") is NEVER sent: the client closes the connection when it receives it, even with empty
 *     rosters (an empty 35 byte message with state 0 did exactly that). A cancelled search or an empty war state is
 *     sent as the "no war" preview instead: state 1, no war id, no opponent, with the clan's own roster. That is what
 *     makes the client show the Start War popup. "WAR_STATE_0_AS_PREVIEW": false sends a real state 0 again (to test).
 *   - "SEND_WAR_MEMBERS": false  -> every roster is sent empty.
 *   - "WAR_MEMBER_NUMBERS": false -> members are sent with their ids and names only, all the numbers (stars, loot,
 *     town hall, map position ...) are left at the client's defaults. Use this to tell a crash caused by the member
 *     numbers apart from one caused by the member list itself.
 */
const sendWarMembers = () => Switches.get('SEND_WAR_MEMBERS', true)
const sendMemberNumbers = () => Switches.get('WAR_MEMBER_NUMBERS', true)
const state0AsPreview = () => Switches.get('WAR_STATE_0_AS_PREVIEW', true)
// The client's own state table (libg.so): 0 NOT_IN_WAR, 1 ENTER_WAR (leader picks who fights), 2 IN_MATCHMAKING (looking for an
// opponent), 3 MATCHED, 4 PREPARATION, 5 IN_WAR, 6 ENDED, 7 CANCELLED. WarManager keeps 'searching' as its own state 1, so a real
// war that is searching goes out as 2; sending 1 showed the member picker instead of the search screen.
// "WAR_SEARCH_STATE": 1 in Gamefiles/clan_event_numbers.json sends the old value again.
const searchState = () => Switches.get('WAR_SEARCH_STATE', 2)

function writeWarMember (stream, clan, member, name, index = 0) {
  if (!sendMemberNumbers()) {
    member = { highID: member.highID, lowID: member.lowID, name: member.name }
    index = 0
  }
  AllianceWarMemberEntry.fromMember(clan, member, name, index).encode(stream)
}

/**
 * Two ways to build it:
 *   new WarDataMessage(client, state, timeLeft)        plain state, clan read from the database
 *   new WarDataMessage(client, war, side, exp)         what WarManager sends: a war record and the clan's side of it
 * With a war record the state and the time left come from the war (searching = 1, preparation = 4,
 * battle = 5, ended = 6, none = 0), the war id is sent for a real war (id > 0) and the opponent is sent once
 * there is one. WarManager always passes a war record; before this was supported the record was written as
 * the "state" (not a number), so the client was told "no war" whatever the war state was.
 *
 * Roster fallback: the war screen shows "N VS N" from the member counts of the two entries. If the own
 * side of a war reaches this message with no members (empty roster), the clan's member list from the
 * database is used for it, so a clan is never shown as "0 VS 0" while it has members.
 */
class WarDataMessage extends PiranhaMessage {
  constructor (client, stateOrWar = 1, timeLeftOrSide = 0) {
    super()
    this.id = 24335
    this.client = client
    this.version = 1

    if (stateOrWar && typeof stateOrWar === 'object') {
      const war = stateOrWar
      const side = timeLeftOrSide && typeof timeLeftOrSide === 'object' ? timeLeftOrSide : war.A
      this.war = war
      this.side = side
      this.opponent = war.A === side ? war.B : war.A
      const serverState = Number(war.state) || 0
      this.warId = Number(war.id) > 0 ? Number(war.id) : 0
      this.state = this.warId > 0 && serverState === 1 ? searchState() : serverState
      this.timeLeft = serverState === 1 || serverState === 0 ? 0 : Math.max(0, Math.floor((Number(war.stateEnds) - Date.now()) / 1000))
    } else {
      this.state = Number(stateOrWar) || 0
      this.timeLeft = Number(timeLeftOrSide) || 0
      this.warId = 0
    }

    // State 0 crashes the client: send the "no war" preview instead (see the header).
    this.remapped = false
    if (this.state === 0 && state0AsPreview()) {
      this.state = 1
      this.timeLeft = 0
      this.warId = 0
      this.opponent = null
      this.remapped = true
    }
  }

  async encode () {
    const player = this.client.player
    if (!player || !player.inClan || !player.clan) {
      throw new Error('the player is not in a clan, so there is no war data to send')
    }

    const withMembers = sendWarMembers()

    let own = this.side
    if (withMembers && (!own || !(own.members && own.members.length))) {
      const clan = await this.client.mongoose.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      if (!clan) throw new Error(`clan ${player.clan.ClanHighID}-${player.clan.ClanLowID} was not found in the database`)
      own = Object.assign({ highID: clan.highID, lowID: clan.lowID, name: clan.name || '', badge: clan.badge || 0 }, own || {}, { members: clan.members || [] })
    } else if (!own) {
      const clan = await this.client.mongoose.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      if (!clan) throw new Error(`clan ${player.clan.ClanHighID}-${player.clan.ClanLowID} was not found in the database`)
      own = { highID: clan.highID, lowID: clan.lowID, name: clan.name || '', badge: clan.badge || 0, members: [] }
    }

    const writeEntry = (clan) => {
      const members = withMembers ? (clan.members || []) : []
      this.writeLong(clan.highID, clan.lowID) // Id
      this.writeString(clan.name || '') // Name
      this.writeInt(clan.badge || 0) // Badge
      this.writeInt(members.length) // MemberCount
      members.forEach((m, i) => writeWarMember(this, clan, m, m.name || '', i))
      return members.length
    }

    this.writeInt(this.state) // State
    this.writeInt(this.timeLeft) // TimeLeft
    const ownCount = writeEntry(own) // own clan

    let enemyCount = 0
    if (this.opponent) {
      this.writeBoolean(true) // has an opponent clan
      enemyCount = writeEntry(this.opponent)
    } else {
      this.writeBoolean(false)
    }

    if (this.warId > 0) {
      this.writeBoolean(true) // has a war id
      this.writeLong(0, this.warId)
    } else {
      this.writeBoolean(false)
    }
    this.writeInt(-1) // no commands

    if (typeof this.client.log === 'function') {
      const note = (this.remapped ? ' (state 0 is sent as the no-war preview, state 1)' : '') +
        (!sendWarMembers() ? ' (SEND_WAR_MEMBERS is off: rosters are sent empty)' : sendMemberNumbers() ? '' : ' (WAR_MEMBER_NUMBERS is off: members have ids and names only)')
      this.client.log(`[War] 24335 state=${this.state} timeLeft=${this.timeLeft} own=${ownCount} opponent=${this.opponent ? enemyCount : 'none'} warId=${this.warId || 'none'}${note}`)
    }
  }
}

module.exports = WarDataMessage
module.exports.writeWarMember = writeWarMember
