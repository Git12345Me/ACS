const PiranhaMessage = require("../../PiranhaMessage")
const AvailableServerCommandMessage = require("../Server/AvailableServerCommandMessage")
const AllianceCreateFailedMessage = require("../Server/AllianceCreateFailedMessage")
const OutOfSyncMessage = require("../Server/OutOfSyncMessage")

const MIN_NAME = 1
const MAX_NAME = 16
const MAX_DESCRIPTION = 128

class CreateAllianceMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14301
    this.version = 1
  }

  async decode () {
    this.data = {}

    this.data.AllianceName = this.readString()
    this.data.AllianceDescription = this.readString()
    this.data.AllianceBadge = this.readInt()
    this.data.AllianceType = this.readInt()
    this.data.RequiredScore = this.readInt()
    this.data.WarFrequency = this.readInt()
    this.data.AllianceOrigin = this.readInt()
  }

  async process () {
    const player = this.client.player
    const db = this.client.mongoose

    // Already in a clan -> client is out of sync
    if (player.inClan) {
      await new OutOfSyncMessage(this.client).send()
      return
    }

    const name = (this.data.AllianceName || "").trim()
    const description = (this.data.AllianceDescription || "").slice(0, MAX_DESCRIPTION)

    // Validation: replaces the old unconditional AllianceCreateFailed
    if (name.length < MIN_NAME) {
      await new AllianceCreateFailedMessage(this.client, 2).send()
      return
    }
    if (name.length > MAX_NAME) {
      await new AllianceCreateFailedMessage(this.client, 3).send()
      return
    }

    const requiredScore = Math.max(0, this.data.RequiredScore || 0)

    try {
      const taken = await db.query(
        "SELECT 1 FROM `clans` WHERE LOWER(`name`) = LOWER(?) LIMIT 1",
        [name]
      )
      if (taken.length > 0) {
        await new AllianceCreateFailedMessage(this.client, 4).send()
        return
      }

      // Creates the clan, adds the player as leader (role 2), saves both.
      // = alliance.Members.Add(...) + Player.AllianceId = alliance.Id
      await db.createClan(player, {
        name,
        description,
        badge: this.data.AllianceBadge,
        type: this.data.AllianceType,
        requiredTrophies: requiredScore,
        warFrequency: this.data.WarFrequency,
        location: this.data.AllianceOrigin
      })

      // = AvailableServerCommand( LogicJoinAlliance )
      await new AvailableServerCommandMessage(this.client, 1).send()
    } catch (e) {
      console.error(e)
      await new AllianceCreateFailedMessage(this.client, 0).send()
    }
  }
}

module.exports = CreateAllianceMessage
