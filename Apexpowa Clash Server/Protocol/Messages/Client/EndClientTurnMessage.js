const fs = require('fs')
const path = require('path')
const PiranhaMessage = require('../../PiranhaMessage')

// Command ids learned while running (Gamefiles/learned_commands.json), e.g. {"donate": 123}.
const LEARNED_FILE = path.join(__dirname, '..', '..', '..', 'Gamefiles', 'learned_commands.json')
function loadLearned () {
  try { return JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8')) } catch (e) { return {} }
}
function saveLearned (learned) {
  try { fs.writeFileSync(LEARNED_FILE, JSON.stringify(learned, null, 2) + '\n') } catch (e) { console.log(`[SERVER] >> could not save ${LEARNED_FILE}: ${e.message}`) }
}
let TrainingQueue = null
try { TrainingQueue = require('../../../Core/TrainingQueue') } catch (e) { console.log(`[SERVER] >> EndClientTurn: could not load Core/TrainingQueue: ${e.message.split('\n')[0]}`) }

// Loads a command file without letting a missing/broken file stop EndClientTurn from loading.
// The reason is printed at startup; the command is then simply unavailable.
function safeRequire (file) {
  try {
    return require(file)
  } catch (e) {
    console.log(`[SERVER] >> EndClientTurn: could not load ${file}: ${e.message.split('\n')[0]}`)
    return undefined
  }
}

const config = require('../../../config.json')

const LogicStartUnlockingBuildingCommand = require('../../Commands/Client/LogicStartUnlockingBuildingCommand')
const LogicMoveBuildingCommand = require('../../Commands/Client/LogicMoveBuildingCommand')
const LogicUpgradeBuildingCommand = require('../../Commands/Client/LogicUpgradeBuildingCommand')
const LogicBuyBuildingCommand = require('../../Commands/Client/LogicBuyBuildingCommand')
const LogicSellBuildingCommand = require('../../Commands/Client/LogicSellBuildingCommand')
const LogicClearObstacleCommand = require('../../Commands/Client/LogicClearObstacleCommand')
const LogicTrainUnitCommand = require('../../Commands/Client/LogicTrainUnitCommand')
const LogicCancelUnitProductionCommand = require('../../Commands/Client/LogicCancelUnitProductionCommand')
const LogicBuyTrapCommand = require('../../Commands/Client/LogicBuyTrapCommand')
const LogicBuyDecoCommand = require('../../Commands/Client/LogicBuyDecoCommand')
const LogicBuyResourceCommand = require('../../Commands/Client/LogicBuyResourceCommand')
const LogicUnlockBuildingCommand = require('../../Commands/Client/LogicUnlockBuildingCommand')
const LogicBuyShieldCommand = require('../../Commands/Client/LogicBuyShieldCommand')
const LogicUpgradeHeroCommand = require('../../Commands/Client/LogicUpgradeHeroCommand')
const LogicUpgradeUnitCommand = require('../../Commands/Client/LogicUpgradeUnitCommand')
const LogicSpeedUpUpgradeUnitCommand = require('../../Commands/Client/LogicSpeedUpUpgradeUnitCommand')
const LogicBuyHeroCommand = require('../../Commands/Client/LogicBuyHeroCommand')
const LogicNewShopItemsSeenCommand = require('../../Commands/Client/LogicNewShopItemsSeenCommand')
const LogicMoveMultipleBuildingsCommand = require('../../Commands/Client/LogicMoveMultipleBuildingsCommand')
const LogicLeagueNotificationsSeenCommand = require('../../Commands/Client/LogicLeagueNotificationsSeenCommand')
const LogicNewsSeenCommand = require('../../Commands/Client/LogicNewsSeenCommand')
const LogicEditModeShownCommand = require('../../Commands/Client/LogicEditModeShownCommand')
const LogicStartClanWarCommand = require('../../Commands/Client/LogicStartClanWarCommand')
const LogicCancelWarSearchCommand = safeRequire('../../Commands/Client/LogicCancelWarSearchCommand')
const LogicWarFailedEchoCommand = safeRequire('../../Commands/Client/LogicWarFailedEchoCommand')
const LogicWarBattleStartCommand = safeRequire('../../Commands/Client/LogicWarBattleStartCommand')
const LogicWarAttackDataCommand = safeRequire('../../Commands/Client/LogicWarAttackDataCommand')
const LogicPlaceAttackerCommand = require('../../Commands/Client/LogicPlaceAttackerCommand')
const LogicEndCombatCommand = require('../../Commands/Client/LogicEndCombatCommand')
const LogicCastSpellCommand = require('../../Commands/Client/LogicCastSpellCommand')
const LogicPlaceHeroCommand = require('../../Commands/Client/LogicPlaceHeroCommand')
const LogicMatchmakingCommand = require('../../Commands/Client/LogicMatchmakingCommand')
const LogicCollectResourcesCommand = require('../../Commands/Client/LogicCollectResourcesCommand')
const LogicSpeedUpTrainingCommand = require('../../Commands/Client/LogicSpeedUpTrainingCommand')
const LogicBoostBuildingCommand = require('../../Commands/Client/LogicBoostBuildingCommand')
const LogicRemoveUnitsCommand = require('../../Commands/Client/LogicRemoveUnitsCommand')
const LogicMissionProgressCommand = require('../../Commands/Client/LogicMissionProgressCommand')
const LogicRequestAllianceUnitsCommand = safeRequire('../../Commands/Client/LogicRequestAllianceUnitsCommand')
const LogicTroopRequestMessageCommand = safeRequire('../../Commands/Client/LogicTroopRequestMessageCommand')
const LogicTroopRequestCommand = safeRequire('../../Commands/Client/LogicTroopRequestCommand')
const LogicTriggerHeroAbilityCommand = safeRequire('../../Commands/Client/LogicTriggerHeroAbilityCommand')
const LogicRotateDefenseCommand = safeRequire('../../Commands/Client/LogicRotateDefenseCommand')
const LogicToggleHeroSleepCommand = safeRequire('../../Commands/Client/LogicToggleHeroSleepCommand')
const LogicDonateAllianceUnitCommand = safeRequire('../../Commands/Client/LogicDonateAllianceUnitCommand')
const LogicJoinAllianceCommand = safeRequire('../../Commands/Client/LogicJoinAllianceCommand')
const LogicLeaveAllianceCommand = safeRequire('../../Commands/Client/LogicLeaveAllianceCommand')
const LogicKickAllianceMemberCommand = safeRequire('../../Commands/Client/LogicKickAllianceMemberCommand')
const LogicChangeAvatarNameCommand = safeRequire('../../Commands/Client/LogicChangeAvatarNameCommand')
const LogicChangeAllianceRoleCommand = safeRequire('../../Commands/Client/LogicChangeAllianceRoleCommand')
const LogicCancelHeroUpgradeCommand = safeRequire('../../Commands/Client/LogicCancelHeroUpgradeCommand')
const LogicEndAttackPreparationCommand = safeRequire('../../Commands/Client/LogicEndAttackPreparationCommand')
const LogicSendAllianceMailCommand = safeRequire('../../Commands/Client/LogicSendAllianceMailCommand')
const LogicSetWarPreferenceCommand = safeRequire('../../Commands/Client/LogicSetWarPreferenceCommand')
const LogicFreeWorkerCommand = require('../../Commands/Client/LogicFreeWorkerCommand')
const LogicToggleAttackModeCommand = require('../../Commands/Client/LogicToggleAttackModeCommand')
const LogicCompatibilityCommand = require('../../Commands/Client/LogicCompatibilityCommand')
const LogicCommandFailed = require('../../Commands/Client/LogicCommandFailed')
const LogicClaimAchievementRewardCommand = require('../../Commands/Client/LogicClaimAchievementRewardCommand')
const LogicSpeedUpClearingCommand = require('../../Commands/Client/LogicSpeedUpClearingCommand')
const LogicEditVillageLayoutCommand = require('../../Commands/Client/LogicEditVillageLayoutCommand')
const LogicSaveVillageLayoutCommand = require('../../Commands/Client/LogicSaveVillageLayoutCommand')
const LogicSetActiveVillageLayoutCommand = require('../../Commands/Client/LogicSetActiveVillageLayoutCommand')
const LogicCopyVillageLayoutCommand = require('../../Commands/Client/LogicCopyVillageLayoutCommand')

class EndClientTurnMessage extends PiranhaMessage {
  constructor (bytes, client) {
    super(bytes)
    this.client = client
    this.id = 14102
    this.version = 1
  }

  async decode () {
    this.data = {}
    
    this.data.Tick = this.readInt()
    this.data.Checksum = this.readInt()
    this.data.Count = this.readInt()

    //console.log(this.data)
  }

  // An unknown command that starts with the stream id and unit of the donation the same player just made
  // (message 14310) is the donate command: LONG stream id, INT unit type, INT unit id. Remember its id.
  learnDonate (commandID) {
    const hint = this.client && this.client.donateHint
    if (!LogicDonateAllianceUnitCommand || !hint || Date.now() - hint.at > 120000) return false
    if (this.offset + 16 > this.buffer.length) return false
    const high = this.buffer.readInt32BE(this.offset)
    const low = this.buffer.readInt32BE(this.offset + 4)
    const unit = this.buffer.readInt32BE(this.offset + 12)
    if (high !== hint.streamHigh || low !== hint.streamLow || unit !== hint.unitID) return false

    const learned = loadLearned()
    learned.donate = commandID
    saveLearned(learned)
    this.client.donateHint = null
    this.client.log(`[Clan] learned: command ${commandID} is LogicDonateAllianceUnitCommand (saved to Gamefiles/learned_commands.json)`)
    return true
  }

  async process () {
    // Troops whose training time has passed join the army before any command (attacks, donations) uses it.
    try { if (TrainingQueue) await TrainingQueue.resolvePlayer(this.client.player) } catch (e) { console.log(`[SERVER] >> training queue: ${e.message}`) }

    const Commands = {
      1: LogicJoinAllianceCommand,
      2: LogicLeaveAllianceCommand,
      3: LogicChangeAvatarNameCommand,
      500: LogicStartUnlockingBuildingCommand,
      501: LogicMoveBuildingCommand,
      502: LogicUpgradeBuildingCommand,
      503: LogicSellBuildingCommand,
      504: LogicBuyBuildingCommand,
      505: LogicSpeedUpClearingCommand,
      506: LogicCollectResourcesCommand,
      507: LogicClearObstacleCommand,
      508: LogicTrainUnitCommand,
      509: LogicCancelUnitProductionCommand,
      510: LogicBuyTrapCommand,
      511: LogicRequestAllianceUnitsCommand,
      512: LogicBuyDecoCommand,
      518: LogicBuyResourceCommand,
      519: LogicMissionProgressCommand,
      513: LogicSpeedUpTrainingCommand,
      516: LogicUpgradeUnitCommand,
      517: LogicSpeedUpUpgradeUnitCommand,
      520: LogicUnlockBuildingCommand,
      521: LogicFreeWorkerCommand,
      522: LogicBuyShieldCommand,
      524: LogicToggleAttackModeCommand,
      526: LogicBoostBuildingCommand,
      523: LogicClaimAchievementRewardCommand,
      527: LogicUpgradeHeroCommand,
      528: LogicBuyHeroCommand,
      529: LogicToggleHeroSleepCommand,
      531: LogicCancelHeroUpgradeCommand,
      532: LogicNewShopItemsSeenCommand,
      533: LogicMoveMultipleBuildingsCommand,
      537: LogicSendAllianceMailCommand,
      538: LogicLeagueNotificationsSeenCommand,
      539: LogicNewsSeenCommand,
      543: LogicKickAllianceMemberCommand,
      540: LogicTroopRequestMessageCommand,
      541: LogicTroopRequestCommand,
      // 0: LogicDonateAllianceUnitCommand, // replace 0 with the id ACS logs as 'undefined <id> command' when you donate
      544: LogicEditModeShownCommand,
      546: LogicEditVillageLayoutCommand,
      550: LogicRemoveUnitsCommand,
      552: LogicSaveVillageLayoutCommand,
      554: LogicRotateDefenseCommand,
      560: LogicStartClanWarCommand,
      561: LogicCancelWarSearchCommand,
      570: LogicSetWarPreferenceCommand,
      607: LogicWarBattleStartCommand,
      608: LogicWarAttackDataCommand,
      8: LogicChangeAllianceRoleCommand,
      13: LogicWarFailedEchoCommand,
      567: LogicSetActiveVillageLayoutCommand,
      568: LogicCopyVillageLayoutCommand,
      600: LogicPlaceAttackerCommand,
      602: LogicEndAttackPreparationCommand,
      603: LogicEndCombatCommand,
      604: LogicCastSpellCommand,
      605: LogicPlaceHeroCommand,
      606: LogicTriggerHeroAbilityCommand,
      700: LogicMatchmakingCommand,
      701: LogicCommandFailed,
    }

    // The donate command id is not in the protocol notes. Once it has been learned (see learnDonate
    // below) it is registered here like every other command.
    const learned = loadLearned()
    if (LogicDonateAllianceUnitCommand && Number.isInteger(learned.donate) && learned.donate > 0 && !Commands[learned.donate]) {
      Commands[learned.donate] = LogicDonateAllianceUnitCommand
    }

    this.Commands = Commands // lets a command (518) decode a command embedded in it
    let prevCommand = 'none (first command of the turn)'
    for (let i = 0; i < this.data.Count; i++) {
      const startOffset = this.offset
      const commandID = this.readInt()
      if (commandID === 0) continue

      if (!Commands[commandID] && this.learnDonate(commandID)) Commands[commandID] = LogicDonateAllianceUnitCommand

      if (!Commands[542]) Commands[542] = require('../../Commands/Client/LogicShareReplayCommand') // SHARE_REPLAY_PATCH
      if (!Commands[601]) Commands[601] = require('../../Commands/Client/LogicPlaceAllianceAttackerCommand')
      if (Commands[commandID]) {
        const command = new Commands[commandID](this.client)

        if (config.Server.Debug) {
          this.client.log(`Gotcha ${commandID} (${command.constructor.name}) command! `)
        }

        const bodyStart = this.offset
        const total = this.buffer.length
        const hexOf = (a, b) => Buffer.from(this.buffer).slice(a, b).toString('hex').replace(/(..)/g, '$1 ').trim()
        try {
          await command.decode(this)
        } catch (e) {
          this.client.log(`[Error] command ${commandID} (${command.constructor.name}) failed while reading at byte ${this.offset} of ${total}: ${e.message} | its bytes so far: ${hexOf(startOffset, this.offset)} | NEXT bytes: ${hexOf(this.offset, this.offset + 32)}`)
          break
        }
        // Byte read check: reading past the end of the packet means the command layout is wrong.
        if (this.offset > total) {
          this.client.log(`[Error] command ${commandID} (${command.constructor.name}) read PAST THE END: it needed up to byte ${this.offset} but the packet has ${total} bytes (${this.offset - total} too many) | bytes: ${hexOf(startOffset, total)}`)
          break
        }
        try { require('../../../Core/LiveReplay').feed(this.client, Buffer.from(this.buffer).slice(startOffset, this.offset), commandID) } catch (e) {}
        prevCommand = `${commandID} (${command.constructor.name}), its data took ${this.offset - bodyStart} bytes: ${hexOf(startOffset, this.offset)}`
        this.client.log(`[Logic] bytes ${commandID} (${command.constructor.name}): data took ${this.offset - bodyStart} byte(s): ${hexOf(startOffset, this.offset)} | NEXT: ${hexOf(this.offset, this.offset + 12)}`)
        try {
          await command.process(this)
        } catch (e) {
          this.client.log(`[Error] command ${commandID} (${command.constructor.name}) failed in process: ${e.message}`)
          console.log(e)
        }
      } else {
        // Shown in the console (starts with [Error]): the command read just before this one is the one
        // with the wrong layout, because it left bytes unread (or read too many).
        this.client.log(`[Error] unknown command ${commandID} (turn command ${i + 1} of ${this.data.Count}); the command before it was ${prevCommand}`)
        // Command length is unknown, so reading on would desync the stream.
        // Record it, drop the rest of this turn and keep the connection alive.
        this.client.log(`Gotcha undefined ${commandID} command! Skipping rest of turn.`)
        const compat = new LogicCompatibilityCommand(commandID)
        await compat.decode(this)
        await compat.process(this)
        break
      }
    }
  }
}

module.exports = EndClientTurnMessage