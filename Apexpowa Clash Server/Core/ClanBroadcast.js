// Sends a message to every connected member of one clan (like the global chat does for
// everybody). Offline members are not reached here; they get the saved entries from the
// clan stream (AllianceStreamMessage) the next time they open the clan chat.
const PlayerManager = require('./PlayerManager')

/**
 * @param {number} clanHighID
 * @param {number} clanLowID
 * @param {(client: object) => {send: Function}} createMessage  builds the message for one client
 * @param {object} [exceptClient]  a client to skip (usually the sender, who already got it)
 * @returns {Promise<number>} how many clients the message was sent to
 */
async function broadcastToClan (clanHighID, clanLowID, createMessage, exceptClient = null) { /*fast*/
  const targets = []
  for (const client of PlayerManager.getAll()) {
    if (client === exceptClient) continue
    const member = client.player
    if (!member || !member.inClan || !member.clan) continue
    if (member.clan.ClanHighID !== clanHighID || member.clan.ClanLowID !== clanLowID) continue
    if (client.destroyed || client.writable === false) continue
    targets.push(client)
  }
  // all members at the same time: one slow connection no longer delays the others
  const results = await Promise.all(targets.map(async client => {
    try {
      await createMessage(client).send()
      return 1
    } catch (e) {
      console.error(e) // one broken connection must not stop the others
      return 0
    }
  }))
  return results.reduce((a, b) => a + b, 0)
}

module.exports = { broadcastToClan }
