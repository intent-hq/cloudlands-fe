import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = 'tests/fixtures/hello-capabilities.json';
const lockPath = 'tests/fixtures/hello-capabilities.lock.json';
const lockKeys = ['fileSha256', 'lockVersion', 'sourceCommit', 'sourcePath', 'sourceRepository'];

function requireValue(condition, message) {
  if (!condition) throw new Error(`hello capabilities: ${message}`);
}

// Offline integrity only. Required CI also compares these exact bytes with the
// canonical fixture at the lock's immutable source commit before running Vitest
// (monorepo docs/protocol/methods/client-hello.md "Capability golden").
export async function loadHelloCapabilities(root = componentRoot) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  requireValue(
    JSON.stringify(Object.keys(lock).sort()) === JSON.stringify(lockKeys),
    `lock keys must be ${lockKeys.join(', ')}`,
  );
  requireValue(lock.lockVersion === 1, 'unsupported lockVersion');
  requireValue(lock.sourceRepository === 'intent-hq/intent', 'invalid sourceRepository');
  requireValue(
    lock.sourcePath === 'docs/protocol/fixtures/hello/capabilities.json',
    'invalid sourcePath',
  );
  requireValue(/^[0-9a-f]{40}$/.test(lock.sourceCommit), 'sourceCommit must be a full SHA');
  requireValue(/^[0-9a-f]{64}$/.test(lock.fileSha256), 'invalid fileSha256');
  const bytes = await readFile(path.join(root, fixturePath));
  requireValue(
    createHash('sha256').update(bytes).digest('hex') === lock.fileSha256,
    'hello-capabilities.json SHA-256 mismatch; re-export it from the monorepo instead of editing it',
  );
  const doc = JSON.parse(bytes.toString('utf8'));
  requireValue(doc.fixtureFormatVersion === 1, 'unsupported fixtureFormatVersion');
  requireValue(
    Array.isArray(doc.profiles) && doc.profiles.some((p) => p.id === 'regular'),
    'profiles must include regular',
  );
  return { profiles: doc.profiles, lock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadHelloCapabilities()
    .then(({ lock }) => {
      // Also accepted by GITHUB_OUTPUT.
      console.info(`sourceCommit=${lock.sourceCommit}\nfileSha256=${lock.fileSha256}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
