#!/usr/bin/env node
import { stageRuntime, bindRuntimeDependencies } from '../lib/runtime-deploy.mjs';

const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
try {
  if (args.includes('--bind')) {
    const result = bindRuntimeDependencies({ source: value('--source'), destination: value('--bind'), root: value('--root') });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const result = stageRuntime({ source: value('--source'), root: value('--root') });
    process.stdout.write(result.release + '\n');
  }
} catch (error) {
  process.stderr.write(`Runtime deployment refused: ${error.message}\n`);
  process.exitCode = 1;
}
