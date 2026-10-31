// @vitest-environment node
// @verify-changed-triggers: scripts/turn-start-fixtures.mjs, tests/fixtures/turn-start-events.json, tests/fixtures/turn-start-events.lock.json, .github/workflows/intent-pr.yml, .github/workflows/nightly-shifted-clock-unit-tests.yml
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTurnStartEvents } from './turn-start-fixtures.mjs';

const directories: string[] = [];
const fixturePath = 'tests/fixtures/turn-start-events.json';
const lockPath = 'tests/fixtures/turn-start-events.lock.json';
const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function standaloneRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'turn-start-fixtures-'));
  directories.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'tests/fixtures'), { recursive: true });
  await cp('scripts/turn-start-fixtures.mjs', path.join(root, 'scripts/turn-start-fixtures.mjs'));
  await cp(fixturePath, path.join(root, fixturePath));
  await cp(lockPath, path.join(root, lockPath));
  return root;
}

async function editLock(root: string, edit: (lock: Record<string, unknown>) => void) {
  const lock = JSON.parse(await readFile(path.join(root, lockPath), 'utf8'));
  edit(lock);
  await writeFile(path.join(root, lockPath), json(lock));
}

describe('offline turn-start events integrity', () => {
  it('loads a standalone checkout and prints the pin for GITHUB_OUTPUT', async () => {
    const root = await standaloneRoot();
    const { events, lock } = await loadTurnStartEvents(root);
    expect(events.length).toBeGreaterThan(0);
    const result = spawnSync(process.execPath, ['scripts/turn-start-fixtures.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `sourceCommit=${lock.sourceCommit}\nfileSha256=${lock.fileSha256}\n`,
    );
  });

  it('rejects an edited copy whose lock was not re-exported', async () => {
    const root = await standaloneRoot();
    const doc = JSON.parse(await readFile(path.join(root, fixturePath), 'utf8'));
    doc.events.pop();
    await writeFile(path.join(root, fixturePath), json(doc));
    await expect(loadTurnStartEvents(root)).rejects.toThrow(/SHA-256 mismatch/);
  });

  it.each([
    ['lockVersion', 2, /lockVersion/],
    ['sourceRepository', 'someone/else', /sourceRepository/],
    ['sourcePath', 'docs/other.json', /sourcePath/],
    ['sourceCommit', 'abc123', /full SHA/],
    ['fileSha256', 'x', /fileSha256/],
    ['extra', 'x', /lock keys/],
  ])('rejects a lock with a bad %s', async (key, value, message) => {
    const root = await standaloneRoot();
    await editLock(root, (lock) => {
      lock[key] = value;
    });
    await expect(loadTurnStartEvents(root)).rejects.toThrow(message);
  });

  it('rejects duplicate event ids even with a matching hash', async () => {
    const root = await standaloneRoot();
    const doc = JSON.parse(await readFile(path.join(root, fixturePath), 'utf8'));
    doc.events[1].id = doc.events[0].id;
    const bytes = json(doc);
    await writeFile(path.join(root, fixturePath), bytes);
    await editLock(root, (lock) => {
      lock.fileSha256 = sha256(bytes);
    });
    await expect(loadTurnStartEvents(root)).rejects.toThrow(/unique nonempty ids/);
  });
});
