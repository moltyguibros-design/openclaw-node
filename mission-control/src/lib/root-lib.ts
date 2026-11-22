/**
 * root-lib.ts — load a root lib/*.mjs at runtime by absolute path, so Mission Control
 * runs the one implementation the daemons and the CLI use instead of a TypeScript twin.
 * The import is deliberately dynamic and outside the bundle.
 *
 * Location candidates, first that exists wins:
 *   $OPENCLAW_LIB_DIR/<file>             (explicit)
 *   <cwd>/../../lib/<file>               (installed: workspace/projects/mission-control)
 *   <cwd>/../lib/<file>                  (repo checkout: mission-control/)
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const loaded = new Map<string, Promise<unknown>>();

function candidates(file: string): string[] {
  const out: string[] = [];
  if (process.env.OPENCLAW_LIB_DIR) out.push(path.join(process.env.OPENCLAW_LIB_DIR, file));
  const cwd = process.cwd();
  out.push(path.resolve(cwd, "..", "..", "lib", file));
  out.push(path.resolve(cwd, "..", "lib", file));
  return out;
}

export function loadRootLib<T>(file: string): Promise<T> {
  let promise = loaded.get(file);
  if (!promise) {
    promise = (async () => {
      const tried = candidates(file);
      const found = tried.find((p) => fs.existsSync(p));
      if (!found) {
        throw new Error(
          `${file} not found (tried: ${tried.join(", ")}). Set OPENCLAW_LIB_DIR to the lib/ directory that holds ${file}.`,
        );
      }
      return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(found).href);
    })().catch((err) => {
      loaded.delete(file); // retry after a fix
      throw err;
    });
    loaded.set(file, promise);
  }
  return promise as Promise<T>;
}
