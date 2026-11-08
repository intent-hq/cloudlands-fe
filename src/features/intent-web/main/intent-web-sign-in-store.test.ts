// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { createSignInCodes } from '../../browser-access/main/browser-access-sign-in-codes';
import { SIGN_IN_FILE, createFileSignInStore } from './intent-web-sign-in-store';

const KEY = 'access-key-0123456789abcdefghijklmnopqrstuvwxyz';
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function dataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-sign-in-'));
  dirs.push(dir);
  return dir;
}
/**
 * Backdate `lock` by `ms` on the filesystem's clock (its own mtime), which the
 * store's staleness check reads, rather than from `Date.now()`, which is not
 * the same clock under the nightly shifted-clock run.
 */
function age(lock: string, ms: number): void {
  const old = new Date(fs.statSync(lock).mtimeMs - ms);
  fs.utimesSync(lock, old, old);
}
const codesIn = (dir: string, options?: Parameters<typeof createFileSignInStore>[1]) =>
  createSignInCodes({ store: createFileSignInStore(dir, options), getAccessKey: () => KEY });

it('hands a code from one store instance to another through a private file', async () => {
  const dir = dataDir();
  const { code } = await codesIn(dir).create();
  if (process.platform !== 'win32') {
    expect(fs.statSync(path.join(dir, SIGN_IN_FILE)).mode & 0o777).toBe(0o600);
  }
  expect(fs.readFileSync(path.join(dir, SIGN_IN_FILE), 'utf8')).not.toContain(
    code.replace('-', ''),
  );
  expect(await codesIn(dir).consume(code)).toBe('ok');
  expect(await codesIn(dir).consume(code)).toBe('used-or-expired');
});

it('lets exactly one of many racing instances consume a code', async () => {
  const dir = dataDir();
  const { code } = await codesIn(dir).create();
  const instances = Array.from({ length: 6 }, () => codesIn(dir));
  const results = await Promise.all(
    instances.flatMap((instance) => [instance.consume(code), instance.consume(code)]),
  );
  expect(results.filter((result) => result === 'ok')).toHaveLength(1);
  expect(fs.existsSync(path.join(dir, `${SIGN_IN_FILE}.lock`))).toBe(false);
});

it('takes over a lock left by a crashed process, but waits for a live one', async () => {
  const dir = dataDir();
  const lock = path.join(dir, `${SIGN_IN_FILE}.lock`);
  fs.writeFileSync(lock, '99999');
  await expect(codesIn(dir, { lockTimeoutMs: 100, staleLockMs: 60_000 }).create()).rejects.toThrow(
    /Timed out/,
  );
  age(lock, 120_000);
  const { code } = await codesIn(dir, { staleLockMs: 60_000 }).create();
  expect(await codesIn(dir).consume(code)).toBe('ok');
});

it('keeps waiting past the lock timeout while the lock changes hands', async () => {
  const dir = dataDir();
  const lock = path.join(dir, `${SIGN_IN_FILE}.lock`);
  const { code } = await codesIn(dir).create();
  // Other holders take turns for 3x the timeout; no single one holds it longer than the timeout.
  fs.writeFileSync(lock, 'holder-0');
  const consumed = codesIn(dir, { lockTimeoutMs: 200 }).consume(code);
  for (let holder = 1; holder <= 6; holder++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(lock, `holder-${holder}`);
  }
  fs.rmSync(lock);
  expect(await consumed).toBe('ok');
});

it('treats a damaged file as empty', async () => {
  const dir = dataDir();
  fs.writeFileSync(path.join(dir, SIGN_IN_FILE), '{not json');
  expect(await codesIn(dir).pageOrigin()).toBeNull();
  const { code } = await codesIn(dir).create();
  expect(await codesIn(dir).consume(code)).toBe('ok');
});

it('never removes a lock that another holder took over', async () => {
  const dir = dataDir();
  const lock = path.join(dir, `${SIGN_IN_FILE}.lock`);
  const codes = codesIn(dir);
  const { code } = await codes.create();
  // Simulate a fresh lock from another process appearing while nobody holds ours.
  fs.writeFileSync(lock, 'someone-else');
  await expect(codesIn(dir, { lockTimeoutMs: 100 }).consume(code)).rejects.toThrow(/Timed out/);
  expect(fs.readFileSync(lock, 'utf8')).toBe('someone-else');
  fs.rmSync(lock);
  expect(await codes.consume(code)).toBe('ok');
});

it('lets exactly one of many waiters take over a stale lock', async () => {
  const dir = dataDir();
  const { code } = await codesIn(dir).create();
  const lock = path.join(dir, `${SIGN_IN_FILE}.lock`);
  fs.writeFileSync(lock, 'crashed');
  age(lock, 120_000);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => codesIn(dir, { staleLockMs: 60_000 }).consume(code)),
  );
  expect(results.filter((result) => result === 'ok')).toHaveLength(1);
  expect(fs.existsSync(lock)).toBe(false);
  expect(fs.readdirSync(dir).filter((name) => name.endsWith('.stale'))).toEqual([]);
});

it.each([
  ['ahead of', 3_600_000],
  ['behind', -3_600_000],
])('judges a lock by the filesystem clock when the process clock runs %s it', async (_, skewMs) => {
  const dir = dataDir();
  const lock = path.join(dir, `${SIGN_IN_FILE}.lock`);
  fs.writeFileSync(lock, 'live-holder');
  const now = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => now() + skewMs);
  await expect(codesIn(dir, { lockTimeoutMs: 100, staleLockMs: 60_000 }).create()).rejects.toThrow(
    /Timed out/,
  );
  expect(fs.readFileSync(lock, 'utf8')).toBe('live-holder');
  age(lock, 120_000);
  const { code } = await codesIn(dir, { lockTimeoutMs: 1000, staleLockMs: 60_000 }).create();
  expect(await codesIn(dir).consume(code)).toBe('ok');
  expect(fs.readdirSync(dir).filter((name) => /\.(stale|probe)$/.test(name))).toEqual([]);
});
