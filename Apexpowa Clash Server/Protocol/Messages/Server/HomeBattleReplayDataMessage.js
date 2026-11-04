const PiranhaMessage = require('../../PiranhaMessage')

const MAX_REPLAY_BYTES = 900000

function toReplayBuffer (data) {
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (data == null) return null
  throw new TypeError('Replay data must be a Buffer, Uint8Array, or string')
}

class HomeBattleReplayDataMessage extends PiranhaMessage {
  constructor (client, replayData) {
    super()
    this.id = 24114
    this.client = client
    this.version = 1
    this.replayData = toReplayBuffer(replayData)
  }

  setReplayData (data) {
    this.replayData = toReplayBuffer(data)
  }

  removeReplayData () {
    const replayData = this.replayData
    this.replayData = null
    return replayData
  }

  async encode () {
    if (!Buffer.isBuffer(this.replayData)) {
      throw new TypeError('Replay data must be set before encoding HomeBattleReplayDataMessage')
    }
    if (this.replayData.length > MAX_REPLAY_BYTES) {
      throw new RangeError(`Replay data exceeds the ${MAX_REPLAY_BYTES}-byte limit`)
    }

    // The C# message writes a length-prefixed byte array; it does not compress a string here.
    this.writeBytes(this.replayData)
  }
}

module.exports = HomeBattleReplayDataMessage
