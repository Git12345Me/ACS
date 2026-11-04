const LeagueUtils = require('../Utilities/LeagueUtils')
const LogicBase = require('./LogicBase')
const CSVManager = require('../Core/CSVManager')

class ClientAvatar {
  async encode (self, player) {
    new LogicBase().encode(self)

    self.writeLong(player.highID, player.lowID) // HighID, LowID
    self.writeLong(player.highID, player.lowID) // HighID, LowID
    
    // The clan shown is the one the PROFILED player is in (player.clan), not the viewer's
    // (self.client.player.clan). It is resolved before anything is written so a clan that
    // cannot be found is sent as "not in a clan" instead of crashing the whole profile.
    let clan = null
    if (player.inClan === 1 && player.clan && self.client && self.client.mongoose &&
        typeof self.client.mongoose.getClanByID === 'function') {
      try {
        clan = await self.client.mongoose.getClanByID(player.clan.ClanHighID, player.clan.ClanLowID)
      } catch (e) {
        console.error(e)
        clan = null
      }
    }

    self.writeByte(clan ? 1 : 0) // IsInAlliance
    if (clan) {
      self.writeLong(player.clan.ClanHighID, player.clan.ClanLowID) // HighID, LowID
      self.writeString(String(clan.name || '')) // AllianceName
      self.writeInt(clan.badge || 0) // AllianceBadge
      { // clan role fallback: players.ClanRole, else the role in the clan's member list, else member
        const mine = (clan.members || []).find(m => m && m.highID === player.highID && m.lowID === player.lowID)
        const role = Number(player.clan.ClanRole) || Number(mine && mine.role) || 1
        if (role !== player.clan.ClanRole) { player.clan.ClanRole = role; if (typeof player.markModified === 'function') player.markModified('clan'); if (typeof player.save === 'function') player.save() }
        self.writeInt(role)
      } // AllianceRole (0-1 = Member, 2 = Leader, 3 = Elder, 4 = Co-Leader)

      self.writeByte(0) // 6.253
    }

    self.writeInt(LeagueUtils.of(player)) // League (from the trophies)

    let village = player.village
    village = JSON.parse(village)
    village.buildings.forEach(b => {
      if (b.data === 1000014) {
        self.writeInt(b.lvl) // AllianceCastleLevel
      }
    })
    self.writeInt(require('../Core/ClanCastle').getClanCastle(player).totalCapacity) // AllianceCastleTotalCapacity (from this village's Clan Castle level)
    const castleUnits = require('../Core/CastleUnits').getUnits(player)
    self.writeInt(castleUnits.reduce((sum, u) => {
      const row = CSVManager.getLevelData('characters', u.unitID, 0)
      return sum + u.count * (row ? Number(row.HousingSpace) || 1 : 1)
    }, 0)) // AllianceCastleUsedCapacity
    village.buildings.forEach(b => {
      if (b.data === 1000001) {
        self.writeInt(b.lvl) // TownhallLevel
      }
    })
    self.writeString(player.name) // Name
    self.writeString(player.facebookID) // FacebookID
    self.writeInt(player.level) // Level
    self.writeInt(player.xpPoints) // Experience
    self.writeInt(player.diamonds) // Diamonds
    self.writeInt(player.diamonds) // FreeDiamonds
    self.writeInt(player.attackRating) // AttackRating
    self.writeInt(player.attackKFactor) // AttackKFactor
    self.writeInt(player.trophies) // Score
    self.writeInt(player.attackWinCount) // AttackWinCount
    self.writeInt(player.attackLoseCount) // AttackLoseCount
    self.writeInt(player.defendWinCount) // DefendWinCount
    self.writeInt(player.defendLoseCount) // DefendLoseCount
    self.writeInt(player.allianceCastleGold) // AllianceCastleGold
    self.writeInt(player.allianceCastleMana) // AllianceCastleMana
    self.writeInt(player.allianceCastleDarkMana) // AllianceCastleDarkMana

    self.writeBoolean(player.nameChangesCount > 1 ? 1 : 0) // nameChangesCount
    self.writeInt(player.cumulativePurchasedDiamonds) // CumulativePurchasedDiamonds

    // Arrays
    // array 1, resource cap data. In a battle the attacker's own village is not loaded, so the game
    // takes the storage "Max:" shown next to the gold / elixir bars from this list. It was always
    // empty, which is why attack mode showed "Max: 0" while the home village (computed from its
    // buildings) showed the right number. Town hall + storages, from buildings.csv at each level.
    const caps = { 3000001: 0, 3000002: 0 }
    for (const b of village.buildings || []) {
      const row = b && CSVManager.getLevelData('buildings', b.data, b.lvl || 0)
      if (!row || b.data === 1000017) continue // 1000017 = goblin main building (NPC village)
      caps[3000001] += Number(row.MaxStoredGold) || 0
      caps[3000002] += Number(row.MaxStoredElixir) || 0
    }
    if (self.capsOverride) { caps[3000001] = self.capsOverride.gold; caps[3000002] = self.capsOverride.mana }
    self.writeInt(2) // array 1 length
    self.writeInt(3000001) // Gold ID
    self.writeInt(caps[3000001]) // Gold storage capacity
    self.writeInt(3000002) // Elixir ID
    self.writeInt(caps[3000002]) // Elixir storage capacity
    self.writeInt(3) // //array 2, resource data
    {
      self.writeInt(3000001) // Gold ID
      self.writeInt(player.gold) // Gold Count
      self.writeInt(3000002) // Elixir ID
      self.writeInt(player.mana) // Elixir Count
      self.writeInt(3000003) // Dark Elixir ID
      self.writeInt(player.darkMana) // Dark Elixir Count
    }
    self.writeInt(player.army ? player.army.length : 0) //array 3, unit slot data
    {
      if (player.army && player.army.length > 0) {
        player.army.forEach(unit => {
          self.writeInt(unit.unitID) // UnitID
          self.writeInt(unit.count) // UnitCount
        })
      }
    }
    self.writeInt(player.spells ? player.spells.length : 0) //array 4, spell slot data
    {
      if (player.spells && player.spells.length > 0) {
        player.spells.forEach(spell => {
          self.writeInt(spell.unitID) // SpellID
          self.writeInt(spell.count) // SpellCount
        })
      }
    }
    // arrays 5 / 6: laboratory levels (0-indexed) saved by LogicUpgradeUnitCommand in the village JSON
    for (const [levels, classID] of [[village.unit_levels, 4], [village.spell_levels, 26]]) {
      const slots = Object.entries(levels || {}).filter(([, level]) => Number(level) > 0)
      self.writeInt(slots.length) // array 5 = unit upgrade slot, array 6 = spell upgrade slot
      for (const [index, level] of slots) {
        self.writeInt(classID * 1000000 + Number(index)) // UnitID / SpellID
        self.writeInt(Number(level)) // UpgradeLevel
      }
    }
    // Hero list: derive it from the village (King altar = 1, King + Queen altars = 2) instead of
    // trusting player.heroes alone. That counter is only raised when an altar is placed in order,
    // so accounts where it lagged behind never received the Queen and the client showed her at level 1.
    const hasKing = village.buildings.some(b => b && b.data === 1000022)
    const hasQueen = village.buildings.some(b => b && b.data === 1000025)
    const heroSlots = Math.max(player.heroes || 0, hasKing ? (hasQueen ? 2 : 1) : 0)
    if (heroSlots !== player.heroes) {
      player.heroes = heroSlots
      if (typeof player.markModified === 'function') player.markModified('heroes')
      if (typeof player.save === 'function') player.save()
    }
    if (self.client && typeof self.client.log === 'function') { // DEBUG: what the client is told about heroes
      const sent = village.buildings.filter(b => b && (b.data === 1000022 || b.data === 1000025))
        .map(b => `${b.data === 1000022 ? 'King(28000000)' : 'Queen(28000001)'} level index ${b.lvl}${b.upgradeTime ? ' upgrading' : ''}`)
      self.client.log(`[Avatar] heroSlots=${heroSlots} -> ${heroSlots >= 1 ? sent.join(', ') : 'no heroes sent'}`)
    }
    self.writeInt(heroSlots) //array 7, hero upgrade slot
    {
      if (heroSlots === 1) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(b.lvl) // Level
          }
        })
      }
      else if (heroSlots === 2) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(b.lvl) // Level
          }
        })
        village.buildings.forEach(b => {
          if (b.data === 1000025) { // Q
            self.writeInt(28000001) // ID
            self.writeInt(b.lvl) // Level
          }
        })
      }
    }
    self.writeInt(heroSlots) //array 8, hero health slot
    {
      if (heroSlots === 1) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(0)
          }
        })
      }
      else if (heroSlots === 2) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(0)
          }
        })
        village.buildings.forEach(b => {
          if (b.data === 1000025) { // AQ
            self.writeInt(28000001) // ID
            self.writeInt(0)
          }
        })
      }
    }
    self.writeInt(heroSlots) //array 9, hero state slot
    {
      if (heroSlots === 1) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(b.hero_sleep ? 2 : 3) // 2 = Sleep, 3 = Guard
          }
        })
      }
      else if (heroSlots === 2) {
        village.buildings.forEach(b => {
          if (b.data === 1000022) { // BK
            self.writeInt(28000000) // ID
            self.writeInt(b.hero_sleep ? 2 : 3) // 2 = Sleep, 3 = Guard
          }
        })
        village.buildings.forEach(b => {
          if (b.data === 1000025) { // AQ
            self.writeInt(28000001) // ID
            self.writeInt(b.hero_sleep ? 2 : 3) // 2 = Sleep, 3 = Guard
          }
        })
      }
    }
    self.writeInt(castleUnits.length) //array 10, alliance unit data (troops donated by clan mates)
    for (const u of castleUnits) {
      self.writeInt(u.unitID) // UnitID
      self.writeInt(u.count) // UnitCount
      self.writeInt(u.level || 0) // UnitLevel (0-indexed)
    }
    if (player.tutorialSteps != 35) {
      player.tutorialSteps = 10
    }
    player.nameChangesCount == 0 ? player.nameChangesCount : 35
    self.writeInt(player.tutorialSteps) //array 11, tutorial steps data
    {
      for (let i = 0; i < player.tutorialSteps; i++) {
        self.writeInt(21000000 + i)
      }
    }
    const achievements = (Array.isArray(player.achievements) ? player.achievements : [])
      .filter(a => a && Number.isSafeInteger(Number(a.id)))
    const claimedAchievements = achievements.filter(a => a.claimed)
    self.writeInt(claimedAchievements.length) //array 12, achievement rewards data (claimed IDs)
    claimedAchievements.forEach(a => self.writeInt(Number(a.id)))
    self.writeInt(achievements.length) //array 13, achievement progress data (ID, value)
    achievements.forEach(a => {
      self.writeInt(Number(a.id))
      self.writeInt(Math.max(0, Number(a.value) || 0))
    })
    self.writeInt(50) //array 14, npc map progress data
    {
      for (let i = 17000000; i < 17000050; i++) {
        self.writeInt(i)
        self.writeInt(3)
      }
    }
    self.writeInt(0) //array 15, npc looted gold data
    self.writeInt(0) //array 16, npc looted elixir data
  }
}

module.exports = ClientAvatar
