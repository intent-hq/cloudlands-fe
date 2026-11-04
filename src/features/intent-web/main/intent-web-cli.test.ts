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
  const help = log.mock.calls.flat().join(' ');
  expect(help).toContain('--data-dir');
  expect(help).toContain('intent-web link');
});
it.skipIf(process.platform === 'win32')(
  'names an explicit tailcat path that is not executable',
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tailcat-'));
    dirs.push(dir);
    const webRoot = path.join(dir, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), 'app');
    const missing = path.join(dir, 'no-tailcat');
    const log = vi.fn();
    const running = await runIntentWeb(
      [
        '--data-dir',
        path.join(dir, 'state'),
        '--socket',
        path.join(dir, 'web.sock'),
        '--no-local',
        '--tailcat',
        missing,
      ],
      { log, webRoot },
    );
    await running!.close();
    expect(log.mock.calls.flat().join('\n')).toContain(
      `tailcat not found or not executable at ${missing}`,
    );
  },
);
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

it.skipIf(process.platform === 'win32')(
  'signs in once with a code that `intent-web link` created in another invocation',
  async () => {
    const { default: http } = await import('node:http');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-link-'));
    dirs.push(dir);
    const webRoot = path.join(dir, 'web');
    fs.mkdirSync(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), 'app');
    const state = path.join(dir, 'state');
    const socket = path.join(dir, 'web.sock');
    const running = await runIntentWeb(['--data-dir', state, '--socket', socket, '--no-local'], {
      log: vi.fn(),
      webRoot,
    });
    const send = (options: {
      method?: string;
      path: string;
      body?: string;
      headers?: Record<string, string>;
    }) =>
      new Promise<{ status: number; cookie: string | undefined }>((resolve, reject) => {
        const req = http.request(
          {
            socketPath: socket,
            method: options.method ?? 'GET',
            path: options.path,
            headers: { Host: 'localhost', ...options.headers },
          },
          (res) => {
            res.resume();
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(options.body);
      });
    const submit = (code: string) =>
      send({
        method: 'POST',
        path: '/__browser-access/login',
        body: `key=${encodeURIComponent(code)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    try {
      const log = vi.fn();
      const created = await runIntentWeb(['link', '--data-dir', state], { log });
      const code = (created as { code: string }).code;
      expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
      expect((created as { link: string | null }).link).toBeNull();
      expect(log.mock.calls.flat().join('\n')).toContain(code);

      // A link preview fetching the page does not spend the code.
      const preview = await send({ path: `/__browser-access/login?code=${code}` });
      expect(preview.status).toBe(200);
      expect(preview.cookie).toBeUndefined();

      const first = await submit(code);
      expect(first.status).toBe(303);
      expect(first.cookie).toBeTruthy();
      expect((await submit(code)).status).toBe(401);

      // A signed-in page load through a front-end records where links should point.
      await send({
        path: '/',
        headers: {
          Cookie: first.cookie!,
          Accept: 'text/html',
          Host: 'box.ts.net',
          'X-Forwarded-Host': 'box.ts.net',
          'X-Forwarded-Proto': 'https',
        },
      });
      await vi.waitFor(async () => {
        const next = await runIntentWeb(['link', '--data-dir', state], { log: vi.fn() });
        expect((next as { link: string | null }).link).toMatch(
          /^https:\/\/box\.ts\.net\/__browser-access\/login\?code=[A-Z2-9]{6}$/,
        );
      });
      const explicit = await runIntentWeb(
        ['link', '--data-dir', state, '--url', 'https://other.example:8443/ignored'],
        { log: vi.fn() },
      );
      expect((explicit as { link: string }).link.startsWith('https://other.example:8443/')).toBe(
        true,
      );
    } finally {
      await running!.close();
    }
  },
);

it('invalidates outstanding codes when the key is reset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-link-reset-'));
  dirs.push(dir);
  const created = await runIntentWeb(['link', '--data-dir', dir], { log: vi.fn() });
  await runIntentWeb(['key', '--reset', '--data-dir', dir], { log: vi.fn() });
  const { loadWebConfig } = await import('./intent-web-config');
  const { createSignInCodes } =
    await import('../../browser-access/main/browser-access-sign-in-codes');
  const { createFileSignInStore } = await import('./intent-web-sign-in-store');
  const codes = createSignInCodes({
    store: createFileSignInStore(dir),
    getAccessKey: () => loadWebConfig(dir).accessKey,
  });
  expect(await codes.consume((created as { code: string }).code)).toBe('invalid');
});

it('rejects --url that is not an http(s) address, and --url without link', async () => {
  await expect(
    runIntentWeb(['link', '--url', 'javascript:alert(1)'], { log: vi.fn() }),
  ).rejects.toThrow(/--url/);
  await expect(
    runIntentWeb(['key', '--url', 'https://box.ts.net'], { log: vi.fn() }),
  ).rejects.toThrow(/--url requires link/);
});
