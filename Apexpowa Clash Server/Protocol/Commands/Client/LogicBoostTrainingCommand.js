/**
 * BoostTraining (C# LogicBoostTrainingCommand): spend gems to boost the training of troops (productionType 0) or spells (1).
 *
 * Layout (C# Decode): INT productionType, INT tick.
 *
 * The C# Execute only works with "new training" (LogicDataTables.GetGlobals().UseNewTraining()) - one shared troop / spell
 * production - and answers -99 otherwise. This server trains with one queue per barracks (Core/TrainingQueue.js), the old training,
 * so the same answer applies: the command is read completely (the rest of the turn stays aligned), nothing is changed, and -99
 * is returned. The gem cost (GetBoostCost) and the boost itself belong to the new training and are not in this server's data.
 *
 * Not registered: the wiki's command list has no BoostTraining. If your client sends it, ACS logs "Gotcha undefined <id> command!" -
 * add that id in EndClientTurnMessage.js:   <id>: LogicBoostTrainingCommand
 */
class LogicBoostTrainingCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.ProductionType = self.readInt() // 0 = troops, 1 = spells
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 0 // BOOST_TRAINING: id not known for this client, see above
  }

  async process (self) {
    const client = (self && self.client) || this.client
    if (client && typeof client.log === 'function') {
      client.log(`[LogicBoostTrainingCommand] ignored: boosting needs the new training, this server uses one queue per barracks (production type ${this.data.ProductionType})`)
    }
    return -99 // UseNewTraining() is false
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicBoostTrainingCommand
