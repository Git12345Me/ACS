const LeaguePlayersMessage = require('../../Messages/Server/LeaguePlayersMessage')

// Command 538: the client sends it when the notifications / league window is opened, and the "My League" list is
// shown from the answer (24503), so the list is sent here (the game does not always send 14503 first).
class LogicLeagueNotificationsSeenCommand {
  async decode (self) {}

  async process (self) {
    if (self.client && self.client.log) self.client.log('[League] 538 seen: sending the league list')
    try {
      await new LeaguePlayersMessage(self.client).send()
    } catch (e) {
      console.error('[League] could not send the league list:', e.message)
    }
  }
}

module.exports = LogicLeagueNotificationsSeenCommand
