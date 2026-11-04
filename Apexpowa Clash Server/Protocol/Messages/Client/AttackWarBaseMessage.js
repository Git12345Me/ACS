const PiranhaMessage = require('../../PiranhaMessage')
const WarManager = require('../../../Core/WarManager')
const WarAttackFailedMessage = require('../Server/WarAttackFailedMessage')
const WarAttackDataMessage = require('../Server/WarAttackDataMessage')
const WarEnemyHomeDataMessage = require('../Server/WarEnemyHomeDataMessage')
const AttackManager = require('../../../Core/AttackManager')

/** 15001 - attack a base in the enemy clan's war roster: long targetAvatarId. wars.md section 6. */
class AttackWarBaseMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 15001
    this.version = 0
  }

  async decode () {
    this.data = {}
    this.data.TargetId = this.readLong()
  }

  async process () {
    AttackManager.cancelPlayerAttack(this.client)
    const target = this.data.TargetId
    const r = await WarManager.beginAttack(this.client, `${target[0]}-${target[1]}`)
    if (r.fail) {
      this.client.log(`[War] attack on ${target[0]}-${target[1]} refused (${r.fail})`)
      await new WarAttackFailedMessage(this.client, r.fail, target).send()
      return
    }

    try {
      const real = await this.client.mongoose.getPlayerByID(target[0], target[1])
      if (!real) throw new Error('defender not found')
      // The base the attacker fights is the roster snapshot, not the defender's current village.
      const enemy = Object.assign({}, real, { village: r.target.base, save: async () => {}, markModified: () => {} })
      this.client.battleKind = 'war'
      this.client.attackEnemy = null // not a normal battle: GoHome / end combat must settle the war attack instead
      this.client.attackDeployed = false
      this.client.battleEvents = []
      this.client.shieldBreakHandled = false
      await new WarEnemyHomeDataMessage(this.client, enemy).send()
      // The war Clan Castle troops of the defender (donated on preparation day) defend the base: unit slots (data, count, level).
      const castle = []
      for (const d of (r.target.donations || [])) {
        for (const u of d.units) {
          const slot = castle.find(x => x.data === u.data)
          if (slot) slot.count += u.count
          else castle.push({ data: u.data, count: u.count, level: 0 })
        }
      }
      await new WarAttackDataMessage(this.client, castle).send()
    } catch (e) {
      console.error('[War] could not start the war attack:', e)
      await WarManager.abortAttack(this.client)
      await new WarAttackFailedMessage(this.client, 8, target).send()
    }
  }
}

module.exports = AttackWarBaseMessage
