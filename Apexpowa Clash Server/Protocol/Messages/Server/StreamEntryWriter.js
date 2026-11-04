// One shared writer for clan stream entries. The full version (with clan event entries:
// promoted / demoted / joined / kicked / left and the EVENT_TYPE table) lives in Core/.
// This file used to be an older copy of it without the events, and every importer loaded this
// old copy, so `writeStreamEntry.EVENT_TYPE` was undefined and changing a member role crashed
// with "Cannot read properties of undefined (reading 'DEMOTED')".
// Re-exporting keeps every existing require('./StreamEntryWriter') working and keeps a single
// module object, so settings such as writeStreamEntry.donateEntries are shared by all importers.
module.exports = require('../../../Core/StreamEntryWriter')
