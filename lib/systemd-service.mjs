export async function readSystemdService(ctx, label) {
  const result = await ctx.exec('systemctl', ['--user', 'show', label,
    '--property=Id,LoadState,ActiveState,SubState,MainPID,NRestarts,ExecMainCode,ExecMainStatus,Result,UnitFileState']);
  const fields = Object.fromEntries(result.stdout.split('\n').filter(line => line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  if (!fields.LoadState) return { label, observable: false, error: result.stderr || 'no systemd state' };
  return {
    label, observable: true, loaded: fields.LoadState === 'loaded', loadState: fields.LoadState,
    active: fields.ActiveState, state: fields.SubState,
    pid: Number(fields.MainPID) || null,
    running: fields.ActiveState === 'active' && Number(fields.MainPID) > 0,
    restarts: Number(fields.NRestarts) || 0,
    execMainCode: Number(fields.ExecMainCode) || 0,
    execMainStatus: Number(fields.ExecMainStatus) || 0,
    lastExitCode: Number(fields.ExecMainCode) === 1 ? Number(fields.ExecMainStatus) || 0 : 0,
    result: fields.Result || null,
    enabled: ['enabled', 'enabled-runtime'].includes(fields.UnitFileState),
  };
}

export function gradeSystemdServices(services) {
  if (!services.length) return { ok: false, observable: false, detail: 'no service state observed' };
  const unknown = services.filter(service => !service.observable);
  if (unknown.length) return { ok: false, observable: false, detail: `systemd state unavailable: ${unknown.map(s => s.label).join(', ')}` };
  const bad = services.filter(service => !service.loaded || !service.running || service.restarts > 0 || service.lastExitCode !== 0 || (service.result && service.result !== 'success'));
  const evidence = services.map(s => `${s.label}:pid=${s.pid || 0},state=${s.active}/${s.state},restarts=${s.restarts},exit=${s.lastExitCode}`).join('; ');
  return {
    ok: bad.length === 0, observable: true, evidence,
    detail: bad.length ? `service(s) stopped or unstable: ${bad.map(s => s.label).join(', ')}` : 'core services active with PID evidence and no automatic restarts',
  };
}

export async function probeSystemdCore(ctx, config) {
  let cohort;
  try { cohort = JSON.parse(await ctx.fsp.readFile(ctx.path.join(config.home, 'config/nats-writer-cohort.json'), 'utf8')); }
  catch (error) { return { ok: false, observable: false, detail: `NATS cohort unavailable: ${error.code || error.message}` }; }
  const known = ['ai.openclaw.nats', 'ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'];
  const labels = cohort.activeLabels;
  const layouts = [known.slice(0, 1), known.slice(1), [known[0], ...known.slice(2)]];
  if (cohort.schema !== 1 || !Array.isArray(labels) || !labels.length
      || !layouts.some(layout => layout.length === labels.length && layout.every(label => labels.includes(label)))) {
    return { ok: false, observable: false, detail: 'NATS cohort declaration invalid' };
  }
  const unit = label => label.replace('ai.openclaw.', 'openclaw-') + '.service';
  const required = ['openclaw-memory-daemon.service', 'openclaw-mission-control.service', ...labels.map(unit)];
  const services = await Promise.all(required.map(label => readSystemdService(ctx, label)));
  const other = await Promise.all(known.filter(label => !labels.includes(label)).map(label => readSystemdService(ctx, unit(label))));
  if (other.some(s => !s.observable)) return { ok: false, observable: false, detail: 'other NATS unit state unavailable' };
  const conflict = other.filter(s => s.active === 'active' || s.active === 'activating');
  if (conflict.length) return { ok: false, observable: true, detail: `unexpected NATS units active: ${conflict.map(s => s.label).join(', ')}` };
  return gradeSystemdServices(services);
}
