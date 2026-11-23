# Mission Control

Next.js dashboard for an OpenClaw node. The app lives under `src/app`. `npm run dev` and
`npm start` bind to 127.0.0.1 only, on port 3000.

## Access

Every page and every `/api` request needs the session token stored in
`~/.openclaw/config/mc-session-token` (created with mode 0600 on the first request the server
handles). Bootstrap once per browser by opening
`http://127.0.0.1:3000/?token=$(cat ~/.openclaw/config/mc-session-token)`: the `mc_session`
cookie is set and the token is stripped from the URL. API clients send
`Authorization: Bearer <token>`. Requests whose Host is not `127.0.0.1` or `localhost` get 403.

The node's own tools (`mc-api`, `mc-health`, memory maintenance, node-watch, the scheduler
heartbeat, `compile-boot`) send that token to `OPENCLAW_MC_API_URL`, default
`http://127.0.0.1:3000`, and refuse any value that is not loopback HTTP without credentials.
`OPENCLAW_MC_URL` only sets the base of the links in notifications, so it may name a tailnet
address without the token ever leaving the machine.

## Environment

The installer writes `.env.local`:

- `WORKSPACE_ROOT`: the OpenClaw workspace. Set it; the code default is a single-operator path.
- `DB_PATH`: the Mission Control SQLite database (default
  `$WORKSPACE_ROOT/projects/mission-control/data/mission-control.db`).
- `OPENCLAW_HOME`: the OpenClaw home (default `~/.openclaw`).

Mesh connectivity (`OPENCLAW_NATS`, `OPENCLAW_NATS_TOKEN`, `OPENCLAW_NATS_AUTH`) and the voice key
(`GOOGLE_API_KEY`) are read from `$OPENCLAW_HOME/openclaw.env`, not from `.env.local`: edit them
there and restart Mission Control. `install.sh --update` removes the copies older installs wrote
into `.env.local`.

## Deploy

The service (launchd `ai.openclaw.mission-control`, systemd `openclaw-mission-control`) runs
from `$WORKSPACE_ROOT/projects/mission-control/`, not from this repo. Follow
`workspace-docs/RUNBOOK_MC_DEPLOY.md`.

## Tests

`npm test` runs vitest over `src/lib/__tests__/`.
