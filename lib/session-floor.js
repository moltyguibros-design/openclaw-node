// Below this a session JSONL is header-only noise (repair 4.6). The memory
// daemon and session-recap share it so they agree on which file is the
// previous session.
const MIN_SESSION_BYTES = 1024;

module.exports = { MIN_SESSION_BYTES };
