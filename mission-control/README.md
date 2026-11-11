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

## Environment

The installer writes `.env.local`:

- `WORKSPACE_ROOT`: the OpenClaw workspace. Set it; the code default is a single-operator path.
- `DB_PATH`: the Mission Control SQLite database (default
  `$WORKSPACE_ROOT/projects/mission-control/data/mission-control.db`).
- `OPENCLAW_HOME`: the OpenClaw home (default `~/.openclaw`).
- `OPENCLAW_NATS`, `OPENCLAW_NATS_TOKEN`, `OPENCLAW_NATS_AUTH`: mesh connectivity. When unset,
  each falls back to `~/.openclaw/openclaw.env`.

## Deploy

The service (launchd `ai.openclaw.mission-control`, systemd `openclaw-mission-control`) runs
from `$WORKSPACE_ROOT/projects/mission-control/`, not from this repo. Follow
`workspace-docs/RUNBOOK_MC_DEPLOY.md`.

## Tests

`npm test` runs vitest over `src/lib/__tests__/`.
