/**
 * Clan roles and what each of them may do. One place for the rules, used by the clan handlers.
 *
 * Role numbers in this protocol (do not change them, the game draws its labels from them):
 *   1 = Member   2 = Leader   3 = Elder   4 = Co-leader
 *
 *   Leader      invite, accept / decline join requests, promote and demote Elders and Co-leaders, kick anyone,
 *               give the leadership to a Co-leader (and become Co-leader), clan mail (1 hour cooldown), start a war
 *   Co-leader   invite, accept join requests, promote and demote Elders, promote new Co-leaders, kick Members and
 *               Elders, clan mail (1 hour cooldown), start a war, create a war vote
 *   Elder       invite, accept join requests, kick Members (once every 20 minutes)
 *   Member      nothing of the above
 *
 * The role of the person who acts is always taken from the clan roster (the saved clan), never from the role cached in
 * their session: a session can be out of date (just promoted, demoted or kicked).
 */
const ROLE = { MEMBER: 1, LEADER: 2, ELDER: 3, COLEADER: 4 }
const ROLE_NAME = { 1: 'Member', 2: 'Leader', 3: 'Elder', 4: 'Co-leader' }
const RANK = { 1: 0, 3: 1, 4: 2, 2: 3 } // member < elder < co-leader < leader

const KICK_COOLDOWN_MS = 20 * 60 * 1000 // an Elder may kick once every 20 minutes
const MAIL_COOLDOWN_MS = 60 * 60 * 1000 // clan mail: once an hour per sender

const ACTIONS = {
  invite: [ROLE.ELDER, ROLE.COLEADER, ROLE.LEADER],
  acceptRequests: [ROLE.ELDER, ROLE.COLEADER, ROLE.LEADER],
  sendMail: [ROLE.COLEADER, ROLE.LEADER],
  startWar: [ROLE.COLEADER, ROLE.LEADER],
  voteWar: [ROLE.COLEADER, ROLE.LEADER],
  editClan: [ROLE.COLEADER, ROLE.LEADER]
}

const same = (a, b) => a && b && a.highID === b.highID && a.lowID === b.lowID

function findMember (clan, highID, lowID) {
  return ((clan && clan.members) || []).find(m => m.highID === highID && m.lowID === lowID) || null
}

/** role of a player according to the clan roster (0 = not in this clan) */
function roleOf (clan, player) {
  const m = player ? findMember(clan, player.highID, player.lowID) : null
  return m ? m.role : 0
}

function can (role, action) {
  return (ACTIONS[action] || []).includes(role)
}

/**
 * May `actorRole` change a member who is now `targetRole` into `newRole`?
 * @returns {{ ok: boolean, reason?: string, handover?: boolean }}  handover = the leader gives the clan to a Co-leader
 */
function checkRoleChange (actorRole, targetRole, newRole) {
  if (![ROLE.MEMBER, ROLE.LEADER, ROLE.ELDER, ROLE.COLEADER].includes(newRole)) return { ok: false, reason: 'unknown role' }
  if (actorRole === ROLE.LEADER) {
    if (newRole === ROLE.LEADER) {
      return targetRole === ROLE.COLEADER
        ? { ok: true, handover: true }
        : { ok: false, reason: 'leadership can only be given to a Co-leader' }
    }
    return { ok: true }
  }
  if (actorRole === ROLE.COLEADER) {
    if (targetRole !== ROLE.MEMBER && targetRole !== ROLE.ELDER) return { ok: false, reason: 'a Co-leader cannot change the Leader or another Co-leader' }
    if (newRole === ROLE.LEADER) return { ok: false, reason: 'a Co-leader cannot give the leadership' }
    return { ok: true } // member <-> elder, and new Co-leaders
  }
  return { ok: false, reason: 'only the Leader and Co-leaders can change roles' }
}

/** May `actorRole` kick someone who is `targetRole`? (the Elder's 20 minute limit is checked separately) */
function checkKick (actorRole, targetRole) {
  if (actorRole === ROLE.LEADER) return targetRole === ROLE.LEADER ? { ok: false, reason: 'the Leader cannot be kicked' } : { ok: true }
  if (actorRole === ROLE.COLEADER) {
    return targetRole === ROLE.MEMBER || targetRole === ROLE.ELDER
      ? { ok: true }
      : { ok: false, reason: 'a Co-leader can only kick Members and Elders' }
  }
  if (actorRole === ROLE.ELDER) return targetRole === ROLE.MEMBER ? { ok: true } : { ok: false, reason: 'an Elder can only kick Members' }
  return { ok: false, reason: 'Members cannot kick' }
}

/** seconds left before `member[field]` (a timestamp in ms, saved in the roster) allows the action again; 0 = allowed */
function cooldownLeft (member, field, ms, now = Date.now()) {
  const last = Number(member && member[field]) || 0
  return Math.max(0, Math.ceil((last + ms - now) / 1000))
}

/**
 * Who becomes Leader when the Leader leaves: the Co-leader who has been in the clan longest, else the longest Elder,
 * else the longest Member (the roster is in joining order). `members` must not contain the leaving leader.
 */
function successor (members) {
  const list = members || []
  for (const role of [ROLE.COLEADER, ROLE.ELDER, ROLE.MEMBER]) {
    const m = list.find(x => x.role === role)
    if (m) return m
  }
  return list[0] || null
}

module.exports = {
  ROLE, ROLE_NAME, RANK, KICK_COOLDOWN_MS, MAIL_COOLDOWN_MS,
  same, findMember, roleOf, can, checkRoleChange, checkKick, cooldownLeft, successor
}
