'use strict';

// The live suites play the agents: a member keeps the member_token its join
// reply carried and presents it on reflect and leave, as bin/mesh-agent.js
// does. A payload that names its own member_token is sent as written.
function withMemberTokens(rpc) {
  const tokens = new Map();
  const key = (p) => `${p.session_id}\u0000${p.node_id}`;
  return async function memberRpc(subject, payload, ...rest) {
    let body = payload;
    if ((subject === 'mesh.collab.reflect' || subject === 'mesh.collab.leave')
        && payload && !('member_token' in payload) && tokens.has(key(payload))) {
      body = { ...payload, member_token: tokens.get(key(payload)) };
    }
    const reply = await rpc(subject, body, ...rest);
    if (subject === 'mesh.collab.join' && reply?.ok && reply.data?.member_token) {
      tokens.set(key(payload), reply.data.member_token);
    }
    return reply;
  };
}

module.exports = { withMemberTokens };
