// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { newLinkEpoch } from '../../browser-access/main/device-login';
import { loadWebConfig, readLinkEpoch, resetWebKey, saveLinkEpoch } from './intent-web-config';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-web-config-'));
  dirs.push(root);
  return path.join(root, 'private');
}
describe('web configuration', () => {
  it('creates a private persistent key and keeps it on restart', () => {
    const dir = directory();
    const first = loadWebConfig(dir);
    expect(first.created).toBe(true);
    expect(Buffer.from(first.accessKey, 'base64url')).toHaveLength(32);
    expect(loadWebConfig(dir)).toMatchObject({
      accessKey: first.accessKey,
      created: false,
      port: 47120,
    });
    if (process.platform !== 'win32') {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    }
  });
  it('rotates the key without changing the saved port', () => {
    const dir = directory();
    const first = loadWebConfig(dir, 47121);
    resetWebKey(dir);
    const next = loadWebConfig(dir);
    expect(next.accessKey).not.toBe(first.accessKey);
    expect(next.port).toBe(47121);
  });
  it('does not overwrite malformed existing configuration', () => {
    const dir = directory();
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.json'), '{broken');
    expect(() => loadWebConfig(dir)).toThrow();
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).toBe('{broken');
  });
  it('saves the running server link epoch privately and replaces it on each start', () => {
    const dir = directory();
    expect(readLinkEpoch(dir)).toBeNull();
    const first = newLinkEpoch();
    saveLinkEpoch(dir, first);
    expect(readLinkEpoch(dir)).toBe(first);
    const second = newLinkEpoch();
    saveLinkEpoch(dir, second);
    expect(readLinkEpoch(dir)).toBe(second);
    expect(() => saveLinkEpoch(dir, 'bad')).toThrow();
    expect(readLinkEpoch(dir)).toBe(second);
    if (process.platform !== 'win32')
      expect(fs.statSync(path.join(dir, 'link-epoch')).mode & 0o777).toBe(0o600);
    fs.writeFileSync(path.join(dir, 'link-epoch'), 'not an epoch');
    expect(readLinkEpoch(dir)).toBeNull();
  });
});
