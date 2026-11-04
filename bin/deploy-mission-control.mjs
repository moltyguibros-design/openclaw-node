#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { deployMissionControl, cleanupMissionControl } from '../lib/mission-control-deploy.mjs';

const { values } = parseArgs({ options: {
  cleanup: { type: 'boolean', default: false }, source: { type: 'string' }, root: { type: 'string' }, workspace: { type: 'string' },
} });
try {
  if (values.cleanup) {
    const result = cleanupMissionControl(values);
    process.stderr.write(`Mission Control retention: ${result.confirmed ? 'confirmed' : 'pending activation'}; removed ${result.removed.length} obsolete build directories\n`);
    process.exit(0);
  }
  const result = deployMissionControl(values);
  process.stderr.write(`Mission Control ${result.changed ? 'built and selected' : 'unchanged'}: ${result.release}\n`);
} catch (error) {
  process.stderr.write(`[Mission Control deployment] ${error.message}\n`);
  process.exitCode = 1;
}
