/**
 * Command 554 - RotateDefense / C# LogicRotateBuildingCommand.
 *
 * Two layouts exist, and decode() tells them apart from the bytes (see below):
 *   short (older X-Bow / Inferno mode toggle): INT buildingId, INT tick
 *   long  (C# LogicRotateBuildingCommand.Decode, 18 bytes after the command id):
 *           INT gameObjectId, INT layout, BOOL draftLayout, BOOL updateListener   <- the two BOOLs share ONE byte
 *           INT baseLayout (-1 = none), BOOL baseDraftLayout, INT tick
 *
 * The long layout is the C# one, read field by field. Execute (C#):
 *   building: when baseLayout is -1 the aim angle of that layout is turned one step (ToggleAimAngle); otherwise it is set to the
 *             angle of the base layout (copying a layout).
 *   trap:     when baseLayout is -1 the direction of that layout is turned to the next one; otherwise it is set to the direction
 *             of the base layout (SetDirection).
 * ACS keeps them in the village JSON as `aim_angle` (degrees) on a building and `dir` on a trap; another layout / the draft layout
 * add a suffix (see keyFor). !! The names of these keys and the step size are NOT confirmed for your client (they are not in your
 * files; the client binary only shows "UseRotate", "MinRotate", "MaxRotate" and "HasDirections"). Change AIM_KEY / DIR_KEY, AIM_STEP
 * and DIRECTIONS below if the game shows nothing after rotating. The decoding itself is exact either way.
 *
 * The short layout keeps its old behaviour: `attack_mode` is flipped (X-Bow ground/air, Inferno single/multi).
 *
 * How short and long are told apart: if 554 is the last command of the turn, the bytes left decide it (4 -> short, 14 -> long);
 * otherwise the int after the id is a tick in the short layout (close to the turn's own tick) and a small layout number in the long.
 */
const Utils = require('../../../Utilities/Utils')

const SHORT_AFTER_ID = 4 // tick
const LONG_AFTER_ID = 14 // layout INT, BYTE (two BOOLs), INT, BYTE, tick  (after the building id)

const AIM_KEY = 'aim_angle' // building: aim angle in degrees
const DIR_KEY = 'dir' // trap: direction number
const AIM_STEP = 45 // degrees per rotation (C#: the building's AimRotateStep)
const DIRECTIONS = 4 // directions a trap turns through (C#: GetDirectionCount())
const CLASS_BUILDING = 500
const CLASS_TRAP = 504

// Layout 0 is the plain key; the draft layout and the other layouts have their own key.
const keyFor = (base, layout, draft) => `${base}${layout > 0 ? layout : ''}${draft ? '_d' : ''}`
const mod = (n, m) => ((n % m) + m) % m
let layoutLogged = false

class LogicRotateDefenseCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.BuildingID = self.readInt()

    const left = self.buffer.length - self.offset
    let long
    if (left === SHORT_AFTER_ID) long = false // last command, only a tick follows
    else if (left === LONG_AFTER_ID) long = true // last command, long layout
    else {
      // More commands follow: peek the next int without consuming it.
      const next = self.buffer.readInt32BE(self.offset)
      const turnTick = (self.data && self.data.Tick) || 0
      // a layout number is tiny; a tick is close to the turn's own tick (ambiguous only for the first few ticks)
      long = next >= 0 && next < 16 && Math.abs(next - turnTick) > 8
    }

    if (long) {
      this.data.Layout = self.readInt()
      this.data.DraftLayout = self.readBoolean()
      this.data.UpdateListener = self.readBoolean() // same byte as DraftLayout
      this.data.BaseLayout = self.readInt()
      this.data.BaseDraftLayout = self.readBoolean()
      this.data.Tick = self.readInt()
    } else {
      this.data.Tick = self.readInt()
    }
    this.data.LongLayout = long

    if (!layoutLogged && self.client && typeof self.client.log === 'function') {
      layoutLogged = true
      self.client.log(`[RotateDefense] 554 decoded as the ${long ? 'long (edit layout)' : 'short (id + tick)'} layout, ${left} bytes were left in the turn`)
    }
  }

  getCommandType () {
    return 554
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const player = client && client.player
    const log = (msg) => { if (client && typeof client.log === 'function') client.log(`[RotateDefense] ${msg}`) }
    if (!player) return -1

    let village
    try { village = JSON.parse(player.village) } catch (e) { return -1 }

    const id = this.data.BuildingID
    const classID = Utils.getClassID(id)

    if (this.data.LongLayout) { // C# LogicRotateBuildingCommand.Execute
      const list = classID === CLASS_BUILDING ? village.buildings : classID === CLASS_TRAP ? village.traps : null
      const object = Array.isArray(list) ? list[Utils.getInstanceID(id)] : null
      if (!object) return log(`object ${id} not found`), -1
      const { Layout, DraftLayout, BaseLayout, BaseDraftLayout } = this.data
      const base = classID === CLASS_BUILDING ? AIM_KEY : DIR_KEY
      const range = classID === CLASS_BUILDING ? 360 : DIRECTIONS
      const step = classID === CLASS_BUILDING ? AIM_STEP : 1
      const here = keyFor(base, Layout, DraftLayout)
      if (BaseLayout === -1) object[here] = mod((Number(object[here]) || 0) + step, range) // toggle
      else object[here] = mod(Number(object[keyFor(base, BaseLayout, BaseDraftLayout)]) || 0, range) // copy from the base layout
      player.village = JSON.stringify(village)
      player.markModified('village')
      await player.save()
      log(`${classID === CLASS_BUILDING ? 'building' : 'trap'} ${id} (${object.data}) ${here} -> ${object[here]}`)
      return 0
    }

    if (classID !== CLASS_BUILDING) return log(`unsupported object class for id ${id}`), -1
    const item = (village.buildings || [])[Utils.getInstanceID(id)]
    if (!item) return log(`building ${id} not found`), -1
    if (!('attack_mode' in item)) return log(`building ${id} (${item.data}) has no rotatable mode`), 0

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

module.exports = LogicRotateDefenseCommand
