/**
 * service-status.js — the service status vocabulary mesh-health-publisher
 * writes to MESH_NODE_HEALTH: 'active', 'down' (installed but not running),
 * 'not-found' (not installed here) or 'unknown' (the probe itself failed).
 * Mission Control marks a node degraded on 'down'/'error'.
 */

/** @param {string|null} raw — `launchctl list <label>` output, null when the label is not loaded */
function launchdServiceStatus(raw) {
  if (!raw) return { status: 'not-found' };
  const pidMatch = raw.match(/"PID"\s*=\s*(\d+)/);
  const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
  return { status: pid ? 'active' : 'down', pid };
}

/**
 * @param {string|null} raw — `systemctl show <unit> --property=LoadState,ActiveState,MainPID`
 * output. `show` exits 0 for any unit, unlike `is-active`, which exits non-zero
 * for every unit that is not active.
 */
function systemdServiceStatus(raw) {
  if (!raw) return { status: 'unknown' };
  const props = Object.fromEntries(raw.split('\n').map((l) => {
    const i = l.indexOf('=');
    return i < 0 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  if (!props.LoadState || !props.ActiveState) return { status: 'unknown' };
  if (props.LoadState === 'not-found') return { status: 'not-found' };
  const pid = parseInt(props.MainPID, 10);
  return {
    status: props.ActiveState === 'active' || props.ActiveState === 'reloading' ? 'active' : 'down',
    pid: pid > 0 ? pid : undefined,
  };
}

module.exports = { launchdServiceStatus, systemdServiceStatus };
