import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentRoot = fileURLToPath(new URL('../', import.meta.url));
const casesPath = 'tests/fixtures/suggested-prompts/v1/cases.json';
const lockPath = 'tests/fixtures/suggested-prompts.lock.json';

function requireValue(condition, message) {
  if (!condition) throw new Error(`suggested-prompts cases: ${message}`);
}

// Offline integrity only. Required CI also compares these exact bytes with the
// canonical cases at the lock's immutable source commit before running Vitest
// (monorepo docs/protocol/suggested-prompts.md).
export async function loadSuggestedPromptsCases(root = componentRoot) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  requireValue(lock.lockVersion === 1, 'unsupported lockVersion');
  requireValue(lock.sourceRepository === 'intent-hq/intent', 'invalid sourceRepository');
  requireValue(
    lock.sourcePath === 'docs/protocol/fixtures/suggested-prompts/v1',
    'invalid sourcePath',
  );
  requireValue(/^[0-9a-f]{40}$/.test(lock.sourceCommit), 'sourceCommit must be a full SHA');
  requireValue(/^[0-9a-f]{64}$/.test(lock.casesSha256), 'invalid casesSha256');
  const bytes = await readFile(path.join(root, casesPath));
  requireValue(
    createHash('sha256').update(bytes).digest('hex') === lock.casesSha256,
    'cases.json SHA-256 mismatch; re-export it from the monorepo instead of editing it',
  );
  const doc = JSON.parse(bytes.toString('utf8'));
  requireValue(doc.fixtureFormatVersion === 1, 'unsupported fixtureFormatVersion');
  requireValue(Array.isArray(doc.cases) && doc.cases.length > 0, 'cases must be nonempty');
  requireValue(
    doc.cases.every((c) => typeof c.id === 'string' && c.id.length > 0) &&
      new Set(doc.cases.map((c) => c.id)).size === doc.cases.length,
    'cases need unique nonempty ids',
  );
  return { cases: doc.cases, lock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadSuggestedPromptsCases()
    .then(({ lock }) => {
      // Also accepted by GITHUB_OUTPUT.
      console.info(`sourceCommit=${lock.sourceCommit}\ncasesSha256=${lock.casesSha256}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
