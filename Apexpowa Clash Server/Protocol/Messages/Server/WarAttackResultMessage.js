const PiranhaMessage = require('../../PiranhaMessage')
const { writeMember, writeHeader, writeEvent } = require('../../../Core/WarWriters')

/** 25004 - result of a war attack: both members, both clan headers, the new event. wars.md section 3. */
class WarAttackResultMessage extends PiranhaMessage {
  constructor (client, r) {
    super()
    this.id = 25004
    this.client = client
    this.version = 1
    this.r = r // { ownClan, enemyClan, attacker, defender, event }
  }

  encode () {
    const { ownClan, enemyClan, attacker, defender, event } = this.r
    this.writeBoolean(false) // +0x40 unknown
    this.writeInt(0) // +0x44 unknown
    writeMember(this, ownClan, attacker) // +0x30
    writeMember(this, enemyClan, defender) // +0x34
    writeHeader(this, ownClan) // +0x38
    writeHeader(this, enemyClan) // +0x3c
    this.writeBoolean(!!event) // +0x48
    if (event) writeEvent(this, event)
  }
}

module.exports = WarAttackResultMessage
