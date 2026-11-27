// @vitest-environment node
// @verify-changed-triggers: scripts/hello-capabilities-fixtures.mjs, tests/fixtures/hello-capabilities.json, tests/fixtures/hello-capabilities.lock.json, .github/workflows/intent-pr.yml, .github/workflows/nightly-shifted-clock-unit-tests.yml
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHelloCapabilities } from './hello-capabilities-fixtures.mjs';

const directories: string[] = [];
const fixturePath = 'tests/fixtures/hello-capabilities.json';
const lockPath = 'tests/fixtures/hello-capabilities.lock.json';

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function standaloneRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hello-capabilities-fixtures-'));
  directories.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'tests/fixtures'), { recursive: true });
  await cp(
    'scripts/hello-capabilities-fixtures.mjs',
    path.join(root, 'scripts/hello-capabilities-fixtures.mjs'),
  );
  await cp(fixturePath, path.join(root, fixturePath));
  await cp(lockPath, path.join(root, lockPath));
  return root;
}

describe('offline hello capabilities integrity', () => {
  it('loads a standalone checkout and prints the pin for GITHUB_OUTPUT', async () => {
    const root = await standaloneRoot();
    const { lock } = await loadHelloCapabilities(root);
    const result = spawnSync(process.execPath, ['scripts/hello-capabilities-fixtures.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `sourceCommit=${lock.sourceCommit}\nfileSha256=${lock.fileSha256}\n`,
    );
  });

  it('rejects a copy edited by hand, such as an added capability', async () => {
    const root = await standaloneRoot();
    const doc = JSON.parse(await readFile(path.join(root, fixturePath), 'utf8'));
    doc.profiles[0].capabilities.handAdded = 1;
    await writeFile(path.join(root, fixturePath), `${JSON.stringify(doc, null, 2)}\n`);
    await expect(loadHelloCapabilities(root)).rejects.toThrow(/SHA-256 mismatch/);
  });
});
