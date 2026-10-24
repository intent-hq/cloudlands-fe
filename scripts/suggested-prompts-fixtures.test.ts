// @vitest-environment node
// @verify-changed-triggers: scripts/suggested-prompts-fixtures.mjs, tests/fixtures/suggested-prompts/**, tests/fixtures/suggested-prompts.lock.json, .github/workflows/intent-pr.yml
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSuggestedPromptsCases } from './suggested-prompts-fixtures.mjs';

const directories: string[] = [];
const casesPath = 'tests/fixtures/suggested-prompts/v1/cases.json';
const lockPath = 'tests/fixtures/suggested-prompts.lock.json';
const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function standaloneRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'suggested-prompts-fixtures-'));
  directories.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await cp(
    'scripts/suggested-prompts-fixtures.mjs',
    path.join(root, 'scripts/suggested-prompts-fixtures.mjs'),
  );
  await cp(
    'tests/fixtures/suggested-prompts',
    path.join(root, 'tests/fixtures/suggested-prompts'),
    {
      recursive: true,
    },
  );
  await cp(lockPath, path.join(root, lockPath));
  return root;
}

async function editLock(root: string, edit: (lock: Record<string, unknown>) => void) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  edit(lock);
  await writeFile(path.join(root, lockPath), json(lock));
}

describe('offline suggested-prompts case integrity', () => {
  it('loads a standalone checkout and prints the pin for GITHUB_OUTPUT', async () => {
    const root = await standaloneRoot();
    const { cases, lock } = await loadSuggestedPromptsCases(root);
    expect(cases.length).toBeGreaterThan(0);
    const result = spawnSync(process.execPath, ['scripts/suggested-prompts-fixtures.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `sourceCommit=${lock.sourceCommit}\ncasesSha256=${lock.casesSha256}\n`,
    );
  });

  it('rejects an edited copy whose lock was not re-exported', async () => {
    const root = await standaloneRoot();
    const doc = JSON.parse(await readFile(path.join(root, casesPath), 'utf8'));
    doc.cases[0].expect.prompts = ['Edited'];
    await writeFile(path.join(root, casesPath), json(doc));
    await expect(loadSuggestedPromptsCases(root)).rejects.toThrow(/SHA-256 mismatch/);
  });

  it.each([
    ['lockVersion', 2, /lockVersion/],
    ['sourceRepository', 'someone/else', /sourceRepository/],
    ['sourcePath', 'docs/other', /sourcePath/],
    ['sourceCommit', 'abc123', /full SHA/],
    ['casesSha256', 'x', /casesSha256/],
  ])('rejects a lock with a bad %s', async (key, value, message) => {
    const root = await standaloneRoot();
    await editLock(root, (lock) => {
      lock[key] = value;
    });
    await expect(loadSuggestedPromptsCases(root)).rejects.toThrow(message);
  });

  it('rejects duplicate case ids even with a matching hash', async () => {
    const root = await standaloneRoot();
    const doc = JSON.parse(await readFile(path.join(root, casesPath), 'utf8'));
    doc.cases[1].id = doc.cases[0].id;
    const bytes = json(doc);
    await writeFile(path.join(root, casesPath), bytes);
    await editLock(root, (lock) => {
      lock.casesSha256 = sha256(bytes);
    });
    await expect(loadSuggestedPromptsCases(root)).rejects.toThrow(/unique nonempty ids/);
  });
});
