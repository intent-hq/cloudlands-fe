// @vitest-environment node
// @verify-changed-triggers: scripts/backend-keychain-fixtures.mjs, tests/fixtures/backend-keychain/**, tests/fixtures/backend-keychain.lock.json, .github/workflows/intent-pr.yml
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBackendKeychainFixtures } from './backend-keychain-fixtures.mjs';

const directories: string[] = [];
const fixtureDirectory = 'tests/fixtures/backend-keychain/v1';
const lockPath = 'tests/fixtures/backend-keychain.lock.json';
const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function standaloneRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'backend-keychain-fixtures-'));
  directories.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await cp(
    'scripts/backend-keychain-fixtures.mjs',
    path.join(root, 'scripts/backend-keychain-fixtures.mjs'),
  );
  await cp('tests/fixtures/backend-keychain', path.join(root, 'tests/fixtures/backend-keychain'), {
    recursive: true,
  });
  await cp(lockPath, path.join(root, lockPath));
  return root;
}

async function rewriteCorpus(root: string, edit: (corpus: any) => void) {
  const { corpus, lock } = await loadBackendKeychainFixtures(root);
  edit(corpus);
  const corpusBytes = json(corpus);
  const manifest = JSON.parse(
    await readFile(path.join(root, fixtureDirectory, 'manifest.json'), 'utf8'),
  );
  manifest.files['corpus.json'] = sha256(corpusBytes);
  const manifestBytes = json(manifest);
  lock.corpusSha256 = sha256(corpusBytes);
  lock.files['corpus.json'] = sha256(corpusBytes);
  lock.files['manifest.json'] = sha256(manifestBytes);
  await writeFile(path.join(root, fixtureDirectory, 'corpus.json'), corpusBytes);
  await writeFile(path.join(root, fixtureDirectory, 'manifest.json'), manifestBytes);
  await writeFile(path.join(root, lockPath), json(lock));
}

describe('offline backend Keychain fixture integrity', () => {
  it('loads a standalone checkout without a monorepo, printing the full pin and digest', async () => {
    const root = await standaloneRoot();
    const { corpus, lock } = await loadBackendKeychainFixtures(root);
    expect(corpus).toEqual(
      JSON.parse(await readFile(path.join(root, fixtureDirectory, 'corpus.json'), 'utf8')),
    );
    const result = spawnSync(process.execPath, ['scripts/backend-keychain-fixtures.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`sourceCommit=${lock.sourceCommit}`);
    expect(result.stdout).toContain(`corpusSha256=${lock.corpusSha256}`);
  });

  it.each([lockPath, `${fixtureDirectory}/corpus.json`, `${fixtureDirectory}/manifest.json`])(
    'fails when %s is missing',
    async (file) => {
      const root = await standaloneRoot();
      await rm(path.join(root, file));
      await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(/ENOENT/);
    },
  );

  it.each(['corpus.json', 'manifest.json'])('rejects changed bytes in %s', async (file) => {
    const root = await standaloneRoot();
    const target = path.join(root, fixtureDirectory, file);
    await writeFile(target, `${await readFile(target, 'utf8')} `);
    await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(/SHA-256 mismatch/);
  });

  it.each([
    'parseCases',
    'identityCases',
    'serializeCases',
    'expiryCases',
    'iosPublishCases',
    'iosImportCases',
    'noWriteCases',
  ])('rejects an empty %s even when rehashed', async (group) => {
    const root = await standaloneRoot();
    await rewriteCorpus(root, (corpus) => {
      corpus[group] = [];
    });
    await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(`${group} must be nonempty`);
  });

  it.each(['fixtureFormatVersion', 'payloadVersion'])(
    'rejects unsupported %s even when rehashed',
    async (field) => {
      const root = await standaloneRoot();
      await rewriteCorpus(root, (corpus) => {
        corpus[field] = 2;
      });
      await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(`unsupported ${field}`);
    },
  );

  it.each(['duplicate id', 'missing reference'])(
    'rejects a %s even when rehashed',
    async (mutation) => {
      const root = await standaloneRoot();
      await rewriteCorpus(root, (corpus) => {
        if (mutation === 'duplicate id') corpus.parseCases.push(corpus.parseCases[0]);
        else corpus.expiryCases[0].parseCaseId = 'missing';
      });
      await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(/unique|parseCaseId/);
    },
  );

  it.each([
    ['sourceCommit', 'main'],
    ['sourceCommit', '2023145'],
    ['sourceRepository', 'another/repository'],
    ['sourcePath', '../somewhere'],
    ['corpusSha256', '0'.repeat(64)],
    ['lockVersion', 2],
  ])('rejects an invalid lock %s (%s)', async (field, value) => {
    const root = await standaloneRoot();
    const { lock } = await loadBackendKeychainFixtures(root);
    lock[field] = value;
    await writeFile(path.join(root, lockPath), json(lock));
    await expect(loadBackendKeychainFixtures(root)).rejects.toThrow(String(field));
  });

  it('exits nonzero when the CLI cannot read its fixtures', async () => {
    const root = await standaloneRoot();
    await rm(path.join(root, fixtureDirectory), { recursive: true });
    const result = spawnSync(process.execPath, ['scripts/backend-keychain-fixtures.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ENOENT');
  });
});
