// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runIntentWeb } from './intent-web-cli';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it('shows the same key across invocations and resets it only on request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cli-'));
  dirs.push(dir);
  const log = vi.fn();
  await runIntentWeb(['key', '--data-dir', dir], { log });
  const first = log.mock.calls[0][0];
  log.mockClear();
  await runIntentWeb(['key', '--data-dir', dir], { log });
  expect(log).toHaveBeenCalledWith(first);
  log.mockClear();
  await runIntentWeb(['key', '--reset', '--data-dir', dir], { log });
  expect(log.mock.calls[0][0]).not.toBe(first);
});
it('prints help without creating configuration', async () => {
  const log = vi.fn();
  await runIntentWeb(['--help'], { log });
  expect(log.mock.calls.flat().join(' ')).toContain('--data-dir');
});
it.skipIf(process.platform === 'win32')(
  'revokes an existing HTTP session when another CLI invocation resets the key',
  async () => {
    const { default: http } = await import('node:http');
    const { SESSION_COOKIE, deriveSessionToken } =
      await import('../../browser-access/main/browser-access-auth');
    const { loadWebConfig } = await import('./intent-web-config');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-reset-'));
    dirs.push(dir);
    const webRoot = path.join(dir, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), 'app');
    const socket = path.join(dir, 'web.sock');
    const log = vi.fn();
    const running = await runIntentWeb(
      ['--data-dir', path.join(dir, 'state'), '--socket', socket, '--no-local'],
      { log, webRoot },
    );
    const key = loadWebConfig(path.join(dir, 'state')).accessKey;
    const request = () =>
      new Promise<number>((resolve, reject) => {
        http
          .get(
            {
              socketPath: socket,
              path: '/__intent-web/connections',
              headers: {
                Host: 'localhost',
                Cookie: `${SESSION_COOKIE}=${deriveSessionToken(key)}`,
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode!);
            },
          )
          .on('error', reject);
      });
    try {
      expect(await request()).toBe(200);
      await runIntentWeb(['key', '--reset', '--data-dir', path.join(dir, 'state')], { log });
      await vi.waitFor(async () => expect(await request()).toBe(401));
    } finally {
      await running!.close();
    }
  },
);
