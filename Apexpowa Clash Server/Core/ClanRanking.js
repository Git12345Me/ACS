/**
 * Member ranking for the clan screen. A member's Order is their live rank by trophies; their
 * PreviousOrder is the rank they had at the last daily snapshot (member.prevRank), which is
 * what makes the client show a rank-up / rank-down arrow.
 *
 * refreshRanks() takes the snapshot (once per day per member, and the first time a member is
 * seen), so the caller must save the clan when it returns true.
 */
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Members sorted by trophies, highest first (rank 1 = index 0). */
function sortMembers (members) {
  return [...(members || [])].sort((a, b) =>
    (Number(b.trophies) || 0) - (Number(a.trophies) || 0) ||
    String(a.name || '').localeCompare(String(b.name || '')) ||
    (Number(a.highID) || 0) - (Number(b.highID) || 0) ||
    (Number(a.lowID) || 0) - (Number(b.lowID) || 0)
  )
}

/** Updates member.prevRank / prevRankAt in place. Returns true when something changed. */
function refreshRanks (members, now = Date.now()) {
  let changed = false
  sortMembers(members).forEach((member, index) => {
    const rank = index + 1
    const age = now - new Date(member.prevRankAt || 0).getTime()
    if (!member.prevRank || !member.prevRankAt || age >= SNAPSHOT_INTERVAL_MS) {
      member.prevRank = rank
      member.prevRankAt = new Date(now).toISOString()
      changed = true
    }
  })
  return changed
}

module.exports = { sortMembers, refreshRanks, SNAPSHOT_INTERVAL_MS }
