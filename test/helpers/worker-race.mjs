import { Worker } from 'node:worker_threads';

// `setup` (module loads) runs before the shared gate opens, so the workers race on
// `act` alone instead of on import time.
export async function raceWorkers({ setup = '', act, data = {}, count = 2 }) {
  const gate = new SharedArrayBuffer(4);
  const code = `
    const { workerData, parentPort } = require('node:worker_threads');
    (async () => {
      ${setup}
      parentPort.postMessage('ready');
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      ${act}
    })().then(() => parentPort.postMessage({ ok: true }), (e) => parentPort.postMessage({ ok: false, error: e.message }));
  `;
  const workers = Array.from({ length: count }, () => new Worker(code, { eval: true, workerData: { ...data, gate } }));
  const next = (w) => new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
  try {
    const ready = await Promise.all(workers.map(next));
    const notReady = ready.find((m) => m !== 'ready');
    if (notReady) throw new Error(`worker setup failed: ${notReady.error}`);
    const results = workers.map(next);
    const flag = new Int32Array(gate);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
