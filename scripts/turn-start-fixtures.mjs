import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = 'tests/fixtures/turn-start-events.json';
const lockPath = 'tests/fixtures/turn-start-events.lock.json';
const lockKeys = ['fileSha256', 'lockVersion', 'sourceCommit', 'sourcePath', 'sourceRepository'];

function requireValue(condition, message) {
  if (!condition) throw new Error(`turn-start events: ${message}`);
}

// Offline integrity only. Required CI also compares these exact bytes with the
// canonical fixture at the lock's immutable source commit before running Vitest
// (monorepo docs/protocol/06-events.md §6.6 "Turn-start signals").
export async function loadTurnStartEvents(root = componentRoot) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  requireValue(
    JSON.stringify(Object.keys(lock).sort()) === JSON.stringify(lockKeys),
    `lock keys must be ${lockKeys.join(', ')}`,
  );
  requireValue(lock.lockVersion === 1, 'unsupported lockVersion');
  requireValue(lock.sourceRepository === 'intent-hq/intent', 'invalid sourceRepository');
  requireValue(
    lock.sourcePath === 'docs/protocol/fixtures/turn-start/turn-start-events.json',
    'invalid sourcePath',
  );
  requireValue(/^[0-9a-f]{40}$/.test(lock.sourceCommit), 'sourceCommit must be a full SHA');
  requireValue(/^[0-9a-f]{64}$/.test(lock.fileSha256), 'invalid fileSha256');
  const bytes = await readFile(path.join(root, fixturePath));
  requireValue(
    createHash('sha256').update(bytes).digest('hex') === lock.fileSha256,
    'turn-start-events.json SHA-256 mismatch; re-export it from the monorepo instead of editing it',
  );
  const doc = JSON.parse(bytes.toString('utf8'));
  requireValue(doc.fixtureFormatVersion === 1, 'unsupported fixtureFormatVersion');
  requireValue(Array.isArray(doc.events) && doc.events.length > 0, 'events must be nonempty');
  requireValue(
    doc.events.every((e) => typeof e.id === 'string' && e.id.length > 0) &&
      new Set(doc.events.map((e) => e.id)).size === doc.events.length,
    'events need unique nonempty ids',
  );
  return { events: doc.events, lock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadTurnStartEvents()
    .then(({ lock }) => {
      // Also accepted by GITHUB_OUTPUT.
      console.info(`sourceCommit=${lock.sourceCommit}\nfileSha256=${lock.fileSha256}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
