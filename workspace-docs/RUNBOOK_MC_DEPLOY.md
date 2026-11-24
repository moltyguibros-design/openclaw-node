# RUNBOOK — Mission Control deploy (repo → live tree)

Distilled from the 2026-07-18 deploy (audits/mc_auth). The live service does NOT run from the
repo: it runs `npm start` from `~/.openclaw/workspace/projects/mission-control/` (launchd
`ai.openclaw.mission-control` on macOS, systemd user unit `openclaw-mission-control` on Linux).
`./install.sh --update` performs steps 1-3 below (sync, `npx -y npm@10 ci`, the better-sqlite3
rebuild under the unit's node, and a build that keeps the previous one if it fails) and is the
normal deploy. It restarts the service only with `--enable-services`, so run step 4 after it
otherwise. A fleet deploy (`mesh-deploy`'s `mc` component) runs the same steps 2-3 through
`scripts/install/mc-build.sh` and then restarts the unit. The manual steps are the same
procedure, for diagnosis. Type-only changes need no deploy.

## The two landmines (both bit us)
1. **Lockfile npm-major skew** — CI and `npm ci` validate with npm 10 (bundled with Node 22); a lockfile
   touched by local npm 11 prunes entries npm 10 requires. ALWAYS install/regenerate with
   `npx -y npm@10`.
2. **Node ABI skew** — the service's unit PATH (plist on macOS, `Environment=PATH` in the systemd
   unit on Linux) resolves an fnm-managed Node 22 (ABI 127), NOT /usr/local/bin node (24, ABI 137).
   better-sqlite3 built under the wrong node → every DB route 500s while the app "runs". Rebuild
   native deps under the service's exact PATH.

## Procedure
```bash
REPO="${OPENCLAW_REPO_DIR:?set it to your openclaw-node checkout}"
D=~/.openclaw/workspace/projects/mission-control
# 1. Sync (env + data preserved; node_modules/.next rebuilt in place)
rsync -a --delete --exclude .env.local --exclude node_modules --exclude .next --exclude .next.prev \
  --exclude data --exclude '*.db' "$REPO"/mission-control/ $D/
# 2. Deps + build with npm 10
cd $D && npx -y npm@10 ci && npm run build
# 3. Native rebuild under the SERVICE's PATH
SVCPATH="$(plutil -p ~/Library/LaunchAgents/ai.openclaw.mission-control.plist | grep -o '"PATH" => ".*"' | cut -d'"' -f4)"  # macOS
SVCPATH="$(systemctl --user show openclaw-mission-control -p Environment --value | tr ' ' '\n' | sed -n 's/^PATH=//p')"  # Linux
env PATH="$SVCPATH" npm rebuild better-sqlite3
# 4. Restart
launchctl kickstart -k gui/$(id -u)/ai.openclaw.mission-control  # macOS
systemctl --user restart openclaw-mission-control                # Linux
```

## Verify (all must hold — matrix from audits/mc_auth)
```bash
TOK=$(cat ~/.openclaw/config/mc-session-token)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/                       # 401 (page gate up; body = bootstrap hint)
curl -s -o /dev/null -w '%{http_code}\n' -b "mc_session=$TOK" http://127.0.0.1:3000/   # 200
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:3000/api/system/health | head -c 80  # {"status":"healthy"..., not an ABI error
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/resolve-path  # 401 (auth gate up)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/resolve-path \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"x"}'  # 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:3000/api/tasks  # 403
```
A browser without the `mc_session` cookie gets 401 on every page and API call. Bootstrap once with
`http://127.0.0.1:3000/?token=$TOK` (the cookie is set and the token stripped from the URL); the cookie
keeps working across deploys as long as `~/.openclaw/config/mc-session-token` is unchanged.
