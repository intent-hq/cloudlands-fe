import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

export function findWebTailcat(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = override ?? env.TAILCAT_BIN;
  const executable = (candidate: string): string | null => {
    try {
      fs.accessSync(
        candidate,
        process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
      );
      return fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
    } catch {
      return null;
    }
  };
  if (explicit) return executable(explicit);
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const found = executable(
      path.join(dir, process.platform === 'win32' ? 'tailcat.exe' : 'tailcat'),
    );
    if (found) return found;
  }
  return null;
}

export async function checkTailcatVersion(
  binary: string,
  expected: string,
  warn: (message: string) => void,
  run: (binary: string) => Promise<string> = async (file) =>
    (await promisify(execFile)(file, ['--version'], { timeout: 5000, maxBuffer: 65536 })).stdout,
): Promise<void> {
  try {
    const version = (await run(binary)).match(/\b\d+\.\d+\.\d+\b/)?.[0];
    if (version !== expected)
      warn(`tailcat version ${version ?? 'unknown'} differs from pinned ${expected}.`);
  } catch {
    warn('Could not read tailcat version; tunnel routes may be unavailable.');
  }
}
