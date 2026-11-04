const PiranhaMessage = require('../../PiranhaMessage')

/**
 * 24326 - base layout + alliance units for a war attack. Required: without it a type-5 battle loads with
 * deployment off (wars.md section 3). Both JSON markers are -1 (absent) and the war castle unit list is empty,
 * which the client decoder accepts. The client answers by queueing command 608.
 */
class WarAttackDataMessage extends PiranhaMessage {
  constructor (client, units = []) {
    super()
    this.id = 24326
    this.client = client
    this.version = 1
    this.units = units // [{ data, count, level }]
  }

  encode () {
    this.writeInt(-1) // JSON 1 (+0x30) absent
    this.writeInt(-1) // JSON 2 (+0x34) absent
    this.writeInt(this.units.length)
    for (const u of this.units) {
      this.writeInt(u.data)
      this.writeInt(u.count)
      this.writeInt(u.level)
    }
  }
}

module.exports = WarAttackDataMessage
