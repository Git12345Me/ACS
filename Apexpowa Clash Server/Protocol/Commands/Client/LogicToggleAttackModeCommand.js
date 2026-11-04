/**
 * Command 524 - ToggleAttackMode (X-Bow ground/air, Inferno Tower single/multi)
 *
 * Layout, worked out from the captured traffic (three presses in one turn):
 *   INT  buildingId  (500xxxxxx)       1d cd 65 08 = 500000008
 *   INT  unknown     (0)               00 00 00 00
 *   BYTE unknown     (2, same each press, so not the new state)   02
 *   INT  tick                           00 00 00 97 / b7 / c3 = 151 / 183 / 195
 * = 13 bytes. Because the byte is constant while the mode alternates, the command is a toggle:
 * the server flips the building's `attack_mode` (same key LogicRotateDefenseCommand uses, and the one
 * starting_home.json stores on X-Bows and Inferno Towers).
 */
const Utils = require('../../../Utilities/Utils')

const TOGGLEABLE = new Set([1000021, 1000027]) // X-Bow, Inferno Tower

class LogicToggleAttackModeCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()
    this.data.Unknown1 = self.readInt()
    this.data.Unknown2 = self.readByte()
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 524
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[ToggleAttackMode] ${msg}`) }
    if (!player) return -1

    let village
    try { village = JSON.parse(player.village) } catch (e) { return -1 }

    const id = this.data.BuildingID
    if (Utils.getClassID(id) !== 500) return log(`unsupported object class for id ${id}`), -1
    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    if (!item) return log(`building ${id} not found`), -1
    if (!('attack_mode' in item) && !TOGGLEABLE.has(item.data)) return log(`building ${id} (${item.data}) has no attack mode`), -1

    item.attack_mode = !item.attack_mode
    player.village = JSON.stringify(village)
    player.markModified('village')
    await player.save()
    log(`building ${id} (${item.data}) attack_mode -> ${item.attack_mode}`)
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicToggleAttackModeCommand
