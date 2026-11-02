#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { stageRuntime, bindRuntimeDependencies, completeInstallation } from '../lib/runtime-deploy.mjs';

try {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, root: { type: 'string' }, bind: { type: 'string' }, json: { type: 'boolean', default: false },
    complete: { type: 'boolean', default: false }, runtime: { type: 'string' }, attempt: { type: 'string' },
    acceptance: { type: 'string' }, 'services-requested': { type: 'string' },
  } });
  if (!values.root) throw new Error('--root is required');
  if (values.complete) {
    if (!values.runtime || !values.attempt || !['true', 'false'].includes(values['services-requested'])) {
      throw new Error('Completion requires runtime, attempt and explicit services-requested');
    }
    const result = completeInstallation({ root: values.root, runtime: values.runtime, attemptId: values.attempt,
      acceptance: values.acceptance, servicesRequested: values['services-requested'] === 'true' });
    if (values.json) process.stdout.write(JSON.stringify(result) + '\n');
  } else if (values.bind) {
    if (!values.source) throw new Error('--source is required');
    const result = bindRuntimeDependencies({ source: values.source, destination: values.bind, root: values.root });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    if (!values.source) throw new Error('--source is required');
    const result = stageRuntime({ source: values.source, root: values.root });
    process.stdout.write(values.json ? JSON.stringify({ release: result.release, attemptId: result.attemptId }) + '\n' : result.release + '\n');
  }
} catch (error) {
  process.stderr.write(`Runtime deployment refused: ${error.message}\n`);
  process.exitCode = 1;
}
