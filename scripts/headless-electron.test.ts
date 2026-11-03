// @verify-changed-triggers: scripts/headless-electron.mjs, scripts/headless-electron-lib.mjs
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('scripts/headless-electron.mjs');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

describe.skipIf(process.platform !== 'linux')('headless-electron xvfb wrapper', () => {
  let dir: string;
  let grandchild = 0;

  afterEach(() => {
    if (grandchild && alive(grandchild)) process.kill(grandchild, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });

  it('stops the whole xvfb-run tree when the launcher is cancelled', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'headless-electron-test-'));
    const pidFile = path.join(dir, 'pid');
    // Stand-in for xvfb-run: a shell with no TERM trap that waits on a
    // grandchild, like the real script waits on Xvfb and the command.
    writeFileSync(
      path.join(dir, 'xvfb-run'),
      `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nwait\n`,
    );
    chmodSync(path.join(dir, 'xvfb-run'), 0o755);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
    delete env.INTENT_HEADLESS_ELECTRON_XVFB;

    const launcher = spawn(process.execPath, [SCRIPT], { env, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) =>
      launcher.once('exit', (code) => resolve(code)),
    );
    expect(
      await waitFor(
        () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '',
        5_000,
      ),
    ).toBe(true);
    grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(alive(grandchild)).toBe(true);

    launcher.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(alive(grandchild)).toBe(false);
  }, 30_000);
});
