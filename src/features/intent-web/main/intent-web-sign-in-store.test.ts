// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { createSignInCodes } from '../../browser-access/main/browser-access-sign-in-codes';
import { SIGN_IN_FILE, createFileSignInStore } from './intent-web-sign-in-store';

const KEY = 'access-key-0123456789abcdefghijklmnopqrstuvwxyz';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function dataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-sign-in-'));
  dirs.push(dir);
  return dir;
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
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  const { code } = await codesIn(dir, { staleLockMs: 60_000 }).create();
  expect(await codesIn(dir).consume(code)).toBe('ok');
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
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => codesIn(dir, { staleLockMs: 60_000 }).consume(code)),
  );
  expect(results.filter((result) => result === 'ok')).toHaveLength(1);
  expect(fs.existsSync(lock)).toBe(false);
  expect(fs.readdirSync(dir).filter((name) => name.endsWith('.stale'))).toEqual([]);
});
