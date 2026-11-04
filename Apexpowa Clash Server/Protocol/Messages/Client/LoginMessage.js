const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')
const LoginFailedMessage = require('../Server/LoginFailedMessage')
const LoginOkMessage = require('../Server/LoginOkMessage')
const OwnHomeDataMessage = require('../Server/OwnHomeDataMessage')
const AvatarStreamMessage = require('../Server/AvatarStreamMessage')
const AllianceStreamMessage = require('../Server/AllianceStreamMessage')
const AllianceFullEntryMessage = require('../Server/AllianceFullEntryMessage')
const AllianceMember = require('../Server/AllianceMember')
const AllianceWarMapDataMessage = require('../Server/AllianceWarMapDataMessage')
const AllianceAllEntryMessage = require('../Server/AllianceAllEntryMessage')
const FriendListMessage = require('../Server/FriendListMessage')

const GlobalChatLineMessage = require('../Server/GlobalChatLineMessage')

const crypto = require('crypto')
const config = require('../../../config.json')

class LoginMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 10101
    this.version = 1
  }

  async decode () {
    this.data = {}

    this.data.HighID = this.readInt()
    this.data.LowID = this.readInt()
    this.data.Token = this.readString()
    this.data.Major = this.readInt()
    this.data.Minor = this.readInt()
    this.data.Build = this.readInt()

    // The phone: the fields that follow the version are the resource fingerprint, then the device ids (UDID, OpenUDID, MAC) and
    // the device model. They are the same on every start of the same phone, so a hash of them identifies it (getPlayer uses it
    // when the client does not send its saved account). Read inside try: a different layout must never break the login.
    this.data.DeviceKey = ''
    try {
      this.readString() // resource fingerprint (changes with the game content, not used)
      const ids = [this.readString(), this.readString(), this.readString(), this.readString()] // UDID, OpenUDID, MAC, device model
      this.data.DeviceInfo = ids.map(v => String(v || '').slice(0, 12))
      if (ids.some(v => v)) this.data.DeviceKey = crypto.createHash('sha1').update(ids.join('|')).digest('hex')
    } catch (e) {
      this.data.DeviceKey = ''
    }

    //console.log(this.data)
  }

  async process () {
    const clientVersion = `${this.data.Major}.${this.data.Build}`.trim()
    const versions = config.Server.Versions.map(v => String(v).trim())
    if (!versions.includes(clientVersion)) {
      await new LoginFailedMessage(this.client, 3, `Your version doesn't match the server version.\nClient Version: ${clientVersion}\nSupported Versions: ${versions.join(", ")}`).send()
      return
    }

    this.client.userObject = Object.assign({}, {
      highID: this.data.HighID,
      lowID: this.data.LowID,
      token: this.data.Token,
      deviceKey: this.data.DeviceKey
    })
    this.client.playerData = this.data
    this.client.log(`[Login] client sent id=${this.data.HighID}-${this.data.LowID} token=${this.data.Token ? String(this.data.Token).slice(0, 8) + '...' : '(empty)'} device=${this.data.DeviceKey ? this.data.DeviceKey.slice(0, 8) : '(none)'} ${JSON.stringify(this.data.DeviceInfo || [])}`)
    this.client.mongoose.getPlayer(this.client, async (err, player) => {
      this.client.player = player
      this.client.log(`[Login] using account ${player.highID}-${player.lowID} "${player.name}" (${this.data.LowID > 0 && this.data.LowID === player.lowID ? 'found by id' : 'NOT matched by id - token or NEW account'})`)
      WarManager.attach(this.client.mongoose) // clan wars
      await WarManager.applyPayouts(this.client.player) // war loot earned while offline
      await new LoginOkMessage(this.client).send()
      await new OwnHomeDataMessage(this.client).send()
      await new AvatarStreamMessage(this.client).send()
      if (this.client.player.inClan === 1) {
        await new AllianceStreamMessage(this.client).send()
        await WarManager.sendWarTo(this.client) // current clan war, if any

        //await new AllianceFullEntryMessage(this.client).send()
        //await new AllianceWarMapDataMessage(this.client).send()
        //await new AllianceAllEntryMessage(this.client).send()
      }
    })
  }
}

module.exports = LoginMessage