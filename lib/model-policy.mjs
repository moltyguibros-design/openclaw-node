import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function setting(key, env) {
  if (env[key] !== undefined) return env[key];
  const home = env.OPENCLAW_HOME || join(env.HOME || homedir(), '.openclaw');
  try {
    return readFileSync(join(home, 'openclaw.env'), 'utf8')
      .split(/\r?\n/).find(line => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function modelsEnabled(env = process.env) {
  return setting('OPENCLAW_MODEL_ENABLED', env) !== '0';
}

export function modelCacheDir(env = process.env) {
  return setting('OPENCLAW_MODEL_CACHE', env) || join(env.HOME || homedir(), '.cache', 'openclaw', 'models');
}

export function createEmbeddingLoader(load, env = process.env) {
  let loading;
  return async () => {
    if (!modelsEnabled(env) || env.OPENCLAW_NO_EMBED_MODEL === '1') {
      throw Object.assign(new Error('Embedding models are disabled on this node'), { code: 'OPENCLAW_MODELS_DISABLED' });
    }
    if (!loading) {
      loading = Promise.resolve().then(() => load({ dtype: 'fp32', cache_dir: modelCacheDir(env) }))
        .catch(error => { loading = undefined; throw error; });
    }
    return loading;
  };
}
