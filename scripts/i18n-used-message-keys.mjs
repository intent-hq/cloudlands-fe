import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Message keys the production i18n bundle ships. The bundle only contains
 * the keys this scan finds, so a missed reference becomes a runtime
 * "m.<key> is not a function" crash in packaged builds.
 */
const MESSAGE_ACCESS = /\b(?:m|msg)\s*\.\s*([$A-Z_a-z][$0-9A-Z_a-z]*)/g;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

/** Keys from `catalogKeys` referenced as `m.<key>` / `msg.<key>` in one source. */
export function messageKeysInSource(source, catalogKeys) {
  const keys = new Set();
  for (const match of source.matchAll(MESSAGE_ACCESS)) {
    if (catalogKeys.has(match[1])) keys.add(match[1]);
  }
  return keys;
}

/** Sorted catalog keys referenced by non-test `.svelte`/`.ts` files under `sourceRoot`. */
export function collectUsedMessageKeys(sourceRoot, catalogKeys) {
  const usedKeys = new Set();
  for (const file of walk(sourceRoot)) {
    if (!/\.(?:svelte|ts)$/.test(file) || /(?:__tests__|\.test\.|\.spec\.)/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('paraglide/messages.js')) continue;
    for (const key of messageKeysInSource(source, catalogKeys)) usedKeys.add(key);
  }
  return [...usedKeys].sort();
}
