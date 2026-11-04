const ROLE = Object.freeze({
  MEMBER: 1,
  LEADER: 2,
  ELDER: 3,
  CO_LEADER: 4
})

const VALID_ROLES = new Set(Object.values(ROLE))

function canInvite (role) {
  return role === ROLE.LEADER || role === ROLE.CO_LEADER || role === ROLE.ELDER
}

function canKick (actorRole, targetRole, isSelf = false) {
  if (isSelf || targetRole === ROLE.LEADER) return false
  if (actorRole === ROLE.LEADER) return true
  if (actorRole === ROLE.CO_LEADER) {
    return targetRole === ROLE.MEMBER || targetRole === ROLE.ELDER
  }
  if (actorRole === ROLE.ELDER) return targetRole === ROLE.MEMBER
  return false
}

function canChangeRole (actorRole, targetRole, newRole, isSelf = false) {
  if (!VALID_ROLES.has(targetRole) || !VALID_ROLES.has(newRole) || isSelf) return false

  if (actorRole === ROLE.LEADER) {
    // Leadership can only be transferred to an existing co-leader.
    if (newRole === ROLE.LEADER) return targetRole === ROLE.CO_LEADER
    return targetRole !== ROLE.LEADER
  }

  if (actorRole === ROLE.CO_LEADER) {
    // Co-leaders can manage members and elders, including promoting either to co-leader.
    return [ROLE.MEMBER, ROLE.ELDER].includes(targetRole) &&
      [ROLE.MEMBER, ROLE.ELDER, ROLE.CO_LEADER].includes(newRole)
  }

  return false
}

module.exports = { ROLE, canInvite, canKick, canChangeRole }
