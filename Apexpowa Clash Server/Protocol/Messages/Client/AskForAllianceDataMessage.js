const PiranhaMessage = require('../../PiranhaMessage')
const AllianceDataMessage = require('../Server/AllianceDataMessage')

class AskForAllianceDataMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14302
    this.version = 1
  }

  async decode () {
    this.data = {}

    this.data.AllianceId = this.readLong()

    //console.log(this.data)
  }

  async process () {
    // Unknown clan: send nothing instead of a fake "Clashers" clan.
    const [high, low] = this.data.AllianceId
    const clan = await this.client.mongoose.getClanByID(high, low)
    if (!clan) {
      this.client.log(`[Alliance] AskForAllianceData lookup miss for clan ${high}-${low}; no AllianceData response sent`)
      return
    }

    const storedMembers = Array.isArray(clan.members) ? clan.members.length : 0
    this.client.log(`[Alliance] AskForAllianceData lookup hit for clan ${high}-${low}; stored roster=${storedMembers}`)
    await new AllianceDataMessage(this.client, this.data.AllianceId).send()
  }
}

module.exports = AskForAllianceDataMessage