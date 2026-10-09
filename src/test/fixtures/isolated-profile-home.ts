import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** A private canonical home for profiles with a nested Unix socket. Caller owns cleanup. */
export function isolatedProfileHome(buildId: string, temporaryRoot = os.tmpdir()): string {
  // Prefer the runner's tracked temp root. macOS expands /var to /private/var,
  // which can leave too little space for the profile's nested socket path.
  for (const parent of [temporaryRoot, '/tmp']) {
    const created = fs.mkdtempSync(path.join(parent, 'ip-'));
    try {
      const canonical = fs.realpathSync(created);
      const socket = path.join(canonical, '.intent-tests', buildId, 'daemon', 'intentd.sock');
      if (Buffer.byteLength(socket) <= 103) return canonical;
    } catch (error) {
      fs.rmSync(created, { recursive: true, force: true });
      throw error;
    }
    fs.rmSync(created, { recursive: true, force: true });
  }
  throw new Error('No temporary home fits the isolated profile socket');
}
