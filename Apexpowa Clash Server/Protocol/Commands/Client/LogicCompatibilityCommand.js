/**
 * Safe command boundary for command ids exported by libg.so but not yet
 * implemented by the emulator.  Commands are length-delimited by
 * EndClientTurnMessage, so this deliberately records and consumes the
 * remaining command payload without mutating player state.
 */
class LogicCompatibilityCommand {
  constructor (commandID) {
    this.commandID = commandID
    this.compatibility = true
  }

  async decode (stream) {
    this.payloadOffset = stream.offset
    this.data = {
      commandID: this.commandID,
      rawPayload: stream.buffer.slice(stream.offset)
    }
    stream.offset = stream.buffer.length

    // Show the unread bytes so the layout of the unknown command can be worked out:
    // e.g. 8 bytes = two INTs (usually id + tick), 4 bytes = tick only.
    const raw = this.data.rawPayload
    const hex = raw.slice(0, 64).toString('hex').replace(/(..)/g, '$1 ').trim()
    stream.client.log(
      `[Error] Unknown command ${this.commandID}: ${raw.length} bytes left in turn: ${hex}${raw.length > 64 ? ' ...' : ''}`
    )
  }

  async process (stream) {}
}

module.exports = LogicCompatibilityCommand