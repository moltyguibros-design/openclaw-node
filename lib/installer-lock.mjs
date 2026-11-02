import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function withOwnedDirectoryLock(directory, operation, action) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Installation transaction is locked: ${directory}`); throw error; }
  const owner = path.join(directory, 'owner.txt');
  const record = `pid=${process.pid}\nnonce=${randomUUID()}\nsource=${operation}\nstarted=${new Date().toISOString()}\n`;
  try {
    fs.writeFileSync(owner, record, { mode: 0o600, flag: 'wx' });
    return action();
  } finally {
    try {
      let owned = true;
      if (fs.existsSync(owner)) {
        if (fs.readFileSync(owner, 'utf8') !== record) {
          process.stderr.write(`Installation lock owner changed; retained: ${directory}\n`);
          owned = false;
        } else {
          fs.unlinkSync(owner);
        }
      }
      if (owned) fs.rmdirSync(directory);
    } catch (error) { process.stderr.write(`Installation lock retained: ${error.message}\n`); }
  }
}

export function withInstallerLock(root, operation, action) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  root = fs.realpathSync(root);
  const directory = path.join(root, '.installer-lock');
  const pid = process.env.OPENCLAW_INSTALLER_LOCK_PID, nonce = process.env.OPENCLAW_INSTALLER_LOCK_NONCE;
  if (pid || nonce) {
    let record = '';
    try { record = fs.readFileSync(path.join(directory, 'owner.txt'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!pid || !nonce || pid !== String(process.ppid) || !record.split('\n').includes(`pid=${pid}`)
      || !record.split('\n').includes(`nonce=${nonce}`)) {
      throw new Error('Inherited installer lock does not match the direct parent and owner record');
    }
    return action(root);
  }
  return withOwnedDirectoryLock(directory, operation, () => action(root));
}
