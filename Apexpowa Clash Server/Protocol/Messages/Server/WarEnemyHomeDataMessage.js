const EnemyHomeDataMessage = require('./EnemyHomeDataMessage')

/**
 * 24107 for a war attack (AttackSource = 4, wars.md section 5/6). EnemyHomeDataMessage ends with
 * writeInt(3) (normal attack) + writeByte(0); this switches the source to 4 without editing that file.
 */
class WarEnemyHomeDataMessage extends EnemyHomeDataMessage {
  async encode () {
    await super.encode()
    const b = this.buffer
    const end = this.offset
    if (end >= 5 && b[end - 5] === 0 && b[end - 4] === 0 && b[end - 3] === 0 && b[end - 2] === 3 && b[end - 1] === 0) {
      b[end - 2] = 4 // AttackSource: 4 = war
    } else if (this.client && typeof this.client.log === 'function') {
      this.client.log('[War] EnemyHomeDataMessage tail changed; AttackSource was not switched to 4')
    }
  }
}

module.exports = WarEnemyHomeDataMessage
