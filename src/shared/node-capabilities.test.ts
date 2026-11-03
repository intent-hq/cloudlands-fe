import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_CAPABILITY_KEYS, pickNodeCapabilities } from './node-capabilities';

const SRC = path.resolve(__dirname, '..');

/** Modules that produce the snapshot rather than gate on it. */
const PRODUCERS = new Set([
  'shared/node-capabilities.ts',
  'lib/client/live/backend-transport.ts',
  'lib/client/live/backend-transport-types.ts',
  'lib/client/live/browser-websocket-transport.ts',
  'lib/client/live/electron-ipc-transport.ts',
]);

/** Reads the observed hello: `observeBackendNodeCapabilities()` or a passed-in observer. */
const OBSERVES = /\bobserve(?:Backend)?(?:Node)?Capabilities\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|svelte)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

/**
 * Capability keys a consumer gates on: strict `=== 1` / `!== 1` reads of
 * `capabilities.<key>` or `caps.<key>`, and the keys of a
 * `capabilities?: { <key>?: unknown }` type literal it casts the hello to.
 */
function gatedKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(/\b(?:capabilities|caps)\??\.(\w+)\s*[!=]==\s*1\b/g))
    keys.add(match[1]);
  for (const literal of source.matchAll(/\bcapabilities\??:\s*\{([^{}]*)\}/g))
    for (const key of literal[1].matchAll(/(\w+)\??:\s*unknown/g)) keys.add(key[1]);
  return [...keys];
}

function consumers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/');
    if (PRODUCERS.has(relative) || relative.startsWith('test/')) continue;
    const source = readFileSync(file, 'utf8');
    if (OBSERVES.test(source)) found.set(relative, gatedKeys(source));
  }
  return found;
}

describe('node capability list', () => {
  it('lists every capability a renderer consumer gates on (intent-hq/intent#8423)', () => {
    const listed = new Set<string>(NODE_CAPABILITY_KEYS);
    const missing = [...consumers()].flatMap(([file, keys]) =>
      keys.filter((key) => !listed.has(key)).map((key) => `${file}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('finds the known consumers, so the scan cannot pass vacuously', () => {
    const keys = new Set([...consumers().values()].flat());
    for (const key of [
      'remoteMachines',
      'remoteInitialAgent',
      'workspaceMembershipEvents',
      'noteTruncatedRead',
      'rawScreenshotRetention',
      'agentNodes',
    ])
      expect(keys).toContain(key);
  });

  it('copies only strict integer advertisements, for every listed key', () => {
    const all = Object.fromEntries(NODE_CAPABILITY_KEYS.map((key) => [key, 1]));
    expect(pickNodeCapabilities({ ...all, unlisted: 1 })).toEqual(all);
    expect(
      pickNodeCapabilities(Object.fromEntries(NODE_CAPABILITY_KEYS.map((key) => [key, true]))),
    ).toEqual(Object.fromEntries(NODE_CAPABILITY_KEYS.map((key) => [key, 0])));
    expect(pickNodeCapabilities(undefined)).toEqual(
      Object.fromEntries(NODE_CAPABILITY_KEYS.map((key) => [key, 0])),
    );
    expect(Object.isFrozen(pickNodeCapabilities(null))).toBe(true);
  });
});
