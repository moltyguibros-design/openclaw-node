#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { archiveRuntime } from '../lib/runtime-retention.mjs';

try {
  const { values } = parseArgs({ options: { root: { type: 'string' }, release: { type: 'string', multiple: true }, 'privileged-process-reader': { type: 'boolean', default: false } } });
  if (!values.root || !values.release?.length) throw new Error('--root and explicit --release digests are required');
  process.stdout.write(JSON.stringify(archiveRuntime({ root: values.root, releases: values.release, privilegedProcessReader: values['privileged-process-reader'] })) + '\n');
} catch (error) {
  process.stderr.write(`Runtime archival refused: ${error.message}\n`);
  process.exitCode = 1;
}
