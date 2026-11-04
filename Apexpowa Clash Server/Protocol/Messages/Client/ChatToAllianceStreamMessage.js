const LeagueUtils = require('../../../Utilities/LeagueUtils')
const PiranhaMessage = require('../../PiranhaMessage')
const AllianceStreamEntryMessage = require('../Server/AllianceStreamEntryMessage')
const OutOfSyncMessage = require('../Server/OutOfSyncMessage')
const ServerErrorMessage = require('../Server/ServerErrorMessage')
const { broadcastToClan } = require('../../../Core/ClanBroadcast')

const CHAT_COOLDOWN_MS = 60 * 60 * 1000

class ChatToAllianceStreamMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14315
    this.version = 1
  }

  async decode () {
    this.data = {}

    this.data.Message = this.readString()

    //console.log(this.data)
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose

    if (!player.inClan) {
      await new OutOfSyncMessage(this.client).send() // Not in a clan
      return
    }
    const text = String(this.data.Message || '').trim()
    if (!text) return

    try {
      const clan = await db.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      if (!clan) {
        await new OutOfSyncMessage(this.client).send()
        return
      }
      const member = (clan.members || []).find(m =>
        m.highID === player.highID && m.lowID === player.lowID
      )
      if (!member) {
        await new OutOfSyncMessage(this.client).send()
        return
      }
      player.clan.ClanRole = Number(member.role) || 1

      const now = Date.now()
      const elapsed = now - (Number(member.lastClanMessageAt) || 0)
      if (elapsed < CHAT_COOLDOWN_MS) {
        const minutes = Math.ceil((CHAT_COOLDOWN_MS - elapsed) / 60000)
        await new ServerErrorMessage(this.client, `Clan messages have a 1-hour cooldown. Try again in ${minutes} minute(s).`).send()
        return
      }
      member.lastClanMessageAt = now

      if (!clan.messages) clan.messages = []
      const maxId = clan.messages.length > 0 
        ? Math.max(...clan.messages.map(m => m.id || 0))
        : 0
      const messageId = maxId + 1

      const chatMessage = {
        id: messageId,
        senderHighID: player.highID,
        senderLowID: player.lowID,
        senderName: player.name,
        senderRole: player.clan.ClanRole,
        senderLevel: player.level,
        senderLeague: LeagueUtils.of(player),
        message: text,
        timestamp: new Date()
      }
      clan.messages.push(chatMessage)
      clan.markModified('messages')
      clan.markModified('members')
      await clan.save()

      await new AllianceStreamEntryMessage(this.client, chatMessage).send()

      // Show it to the other clan members that are online right now (it is saved above for the rest).
      await broadcastToClan(player.clan.ClanHighID, player.clan.ClanLowID, c => new AllianceStreamEntryMessage(c, chatMessage), this.client)
    } catch (e) {
      console.error(e)
      await new OutOfSyncMessage(this.client).send()
    }
  }
}

module.exports = ChatToAllianceStreamMessage