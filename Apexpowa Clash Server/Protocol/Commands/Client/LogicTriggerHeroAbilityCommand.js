/**
 * Command 606 - TriggerHeroAbility ("UseHeroAbility" in coc-messages)
 *
 * Port of the C# LogicTriggerHeroAbilityCommand.
 * Layout (coc-messages CommandComponent id 606):
 *   INT heroData   hero global id (28xxxxxx)
 *   INT tick       battle tick at which the ability was triggered
 *
 * C# -> ACS mapping:
 *   Decode: ReadDataReference(HERO) + base.Decode  ->  readInt() x2
 *           (ACS handlers read the data reference as a plain INT global id, and the
 *            base command's tick is the trailing INT, same as 600/604/605)
 *   Encode / LoadFromJSON / GetJSONForReplay / Destruct
 *           -> not needed: ACS only decodes client commands and keeps no replays
 *   Execute: the C# loop walks LogicGameObjectManager for friendly (team 0) living
 *           heroes whose data matches, checks HasAbility / cooldown / once-ability
 *           and calls StartAbility(). ACS has no battle simulation (no
 *           GameObjectManager, LogicCharacter or hitpoint components) - the client
 *           plays the fight locally, exactly as with PlaceHero / CastSpell - so there
 *           is no character state to start an ability on. The cooldown/once-only
 *           checks therefore live on the client; the server only needs to consume
 *           the command so the rest of the turn stays aligned.
 *
 * process() records the activation on the client's session so later phases
 * (battle validation / replays) can use it. Nothing is written to the database.
 */
const HERO_CLASS_ID = 28 // 28xxxxxx = heroes

class LogicTriggerHeroAbilityCommand {
  constructor (client = null) {
    this.client = client
    this.data = {}
  }

  async decode (self) {
    this.data = {}
    this.data.HeroID = self.readInt() // LogicHeroData global id
    this.data.Tick = self.readInt()
  }

  getCommandType () {
    return 606
  }

  async process (self) {
    const client = (self && self.client) || this.client
    const heroID = this.data.HeroID

    // Equivalent of "character.GetData() == m_data": the id must be a hero.
    if (Math.floor(heroID / 1000000) !== HERO_CLASS_ID) {
      if (client && typeof client.log === 'function') {
        client.log(`[Battle] TriggerHeroAbility with non-hero id ${heroID} ignored`)
      }
      return 0
    }

    if (client) {
      if (!Array.isArray(client.heroAbilityLog)) client.heroAbilityLog = []
      client.heroAbilityLog.push({ heroID, hero: heroID % 1000000, tick: this.data.Tick })
    }
    return 0
  }

  destruct () {
    this.client = null
    this.data = {}
  }
}

module.exports = LogicTriggerHeroAbilityCommand
