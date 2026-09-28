import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = 'tests/fixtures/backend-keychain/v1';
const lockPath = 'tests/fixtures/backend-keychain.lock.json';
const files = ['corpus.json', 'manifest.json'];
const caseGroups = [
  'parseCases',
  'identityCases',
  'serializeCases',
  'expiryCases',
  'iosPublishCases',
  'iosImportCases',
  'noWriteCases',
];

function requireValue(condition, message) {
  if (!condition) throw new Error(`backend Keychain fixtures: ${message}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Offline integrity only. Required CI also compares these exact bytes with the
// canonical tool from the lock's immutable source commit before running Vitest.
export async function loadBackendKeychainFixtures(root = componentRoot) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  requireValue(lock.lockVersion === 1, 'unsupported lockVersion');
  requireValue(lock.sourceRepository === 'intent-hq/intent', 'invalid sourceRepository');
  requireValue(
    lock.sourcePath === 'docs/protocol/fixtures/backend-keychain/v1',
    'invalid sourcePath',
  );
  requireValue(/^[0-9a-f]{40}$/.test(lock.sourceCommit), 'sourceCommit must be a full SHA');
  requireValue(/^[0-9a-f]{64}$/.test(lock.corpusSha256), 'invalid corpusSha256');
  requireValue(
    JSON.stringify(Object.keys(lock.files ?? {}).sort()) === JSON.stringify(files),
    'lock must hash corpus.json and manifest.json',
  );
  const [corpusBytes, manifestBytes] = await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(path.join(root, fixtureDirectory, file));
      requireValue(sha256(bytes) === lock.files[file], `${file} SHA-256 mismatch`);
      return bytes;
    }),
  );
  const corpus = JSON.parse(corpusBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  for (const [name, value] of Object.entries({ corpus, manifest })) {
    requireValue(value.fixtureFormatVersion === 1, `${name}: unsupported fixtureFormatVersion`);
    requireValue(value.payloadVersion === 1, `${name}: unsupported payloadVersion`);
  }
  requireValue(
    sha256(corpusBytes) === lock.corpusSha256 &&
      manifest.files?.['corpus.json'] === lock.corpusSha256,
    'corpusSha256 disagrees with manifest or corpus',
  );
  for (const group of caseGroups) {
    const cases = corpus[group];
    requireValue(Array.isArray(cases) && cases.length > 0, `${group} must be nonempty`);
    requireValue(
      cases.every((c) => typeof c.id === 'string' && c.id.length > 0) &&
        new Set(cases.map((c) => c.id)).size === cases.length,
      `${group} needs unique nonempty case ids`,
    );
  }
  const parseIds = new Set(corpus.parseCases.map((c) => c.id));
  for (const group of ['expiryCases', 'iosImportCases', 'noWriteCases']) {
    for (const c of corpus[group]) {
      requireValue(parseIds.has(c.parseCaseId), `${group}/${c.id}: missing parseCaseId`);
    }
  }
  return { corpus, lock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadBackendKeychainFixtures()
    .then(({ lock }) => {
      // Also accepted by GITHUB_OUTPUT; print both values in each required CI shard.
      console.info(`sourceCommit=${lock.sourceCommit}\ncorpusSha256=${lock.corpusSha256}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
