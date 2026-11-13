// @verify-changed-triggers: scripts/i18n-json-merge.mjs, .gitattributes, messages/*.json

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { driverCommand, mergeCatalogs, mergeTexts, serializeCatalog } from './i18n-json-merge.mjs';

const scriptPath = join(process.cwd(), 'scripts/i18n-json-merge.mjs');
const CATALOG = 'messages/en.json';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]) {
  return spawnSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } },
  );
}

function gitOk(dir: string, ...args: string[]) {
  const result = git(dir, ...args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

function commitCatalog(dir: string, catalog: Record<string, string> | null, message: string) {
  if (catalog) {
    mkdirSync(join(dir, 'messages'), { recursive: true });
    writeFileSync(join(dir, CATALOG), serializeCatalog(catalog));
  }
  gitOk(dir, 'add', '-A');
  gitOk(dir, 'commit', '-q', '-m', message);
}

/**
 * A repo whose `main` and `other` branches each changed the base catalog (`null`: no
 * catalog in the base commit). `driver` is false, true, or the driver script path.
 */
function forkedRepo(
  base: Record<string, string> | null,
  ours: Record<string, string>,
  theirs: Record<string, string>,
  { driver }: { driver: boolean | string },
) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-json-merge-'));
  tempDirs.push(dir);
  gitOk(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitattributes'), readFileSync('.gitattributes', 'utf8'));
  if (driver) {
    const script = typeof driver === 'string' ? driver : scriptPath;
    gitOk(dir, 'config', 'merge.i18n-json.driver', driverCommand(script, process.execPath));
  }
  commitCatalog(dir, base, 'base');
  gitOk(dir, 'switch', '-q', '-c', 'other');
  commitCatalog(dir, theirs, 'theirs');
  gitOk(dir, 'switch', '-q', 'main');
  commitCatalog(dir, ours, 'ours');
  return dir;
}

function readCatalog(dir: string) {
  return JSON.parse(readFileSync(join(dir, CATALOG), 'utf8'));
}

const BASE = {
  $schema: 'https://inlang.com/schema/inlang-message-format',
  a_label: 'A',
  b_label: 'B',
};
const OURS_APPEND = { ...BASE, machineSetup_title: 'Set up', machineSetup_error: 'Failed' };
const THEIRS_APPEND = {
  ...BASE,
  sessionImport_tab_label: 'Sessions',
  sessionImport_refresh: 'Refresh',
};
const BOTH_APPENDS = [
  '$schema',
  'a_label',
  'b_label',
  'machineSetup_title',
  'machineSetup_error',
  'sessionImport_tab_label',
  'sessionImport_refresh',
];

describe('git merge with the i18n-json driver', () => {
  it('merges two branches that each appended different keys', () => {
    const dir = forkedRepo(BASE, OURS_APPEND, THEIRS_APPEND, { driver: true });

    const merge = git(dir, 'merge', '--no-edit', 'other');

    expect(merge.status, merge.stdout + merge.stderr).toBe(0);
    expect(Object.keys(readCatalog(dir))).toEqual(BOTH_APPENDS);
    expect(gitOk(dir, 'status', '--porcelain')).toBe('');
  });

  it('still stops the merge when both sides changed the same key differently', () => {
    const dir = forkedRepo(
      BASE,
      { ...OURS_APPEND, a_label: 'Ours A' },
      { ...THEIRS_APPEND, a_label: 'Theirs A' },
      { driver: true },
    );

    const merge = git(dir, 'merge', '--no-edit', 'other');

    expect(merge.status).not.toBe(0);
    expect(merge.stderr).toContain('a_label');
    const text = readFileSync(join(dir, CATALOG), 'utf8');
    expect(text).toContain('<<<<<<<');
    expect(text).toContain('"a_label": "Ours A"');
    expect(text).toContain('"a_label": "Theirs A"');
    expect(gitOk(dir, 'ls-files', '-u', CATALOG)).not.toBe('');
  });
  it('stops with conflict markers when a key conflicts but the text merge is clean', () => {
    const dir = forkedRepo(
      BASE,
      { ...BASE, dup_label: 'Ours' },
      { $schema: BASE.$schema, dup_label: 'Theirs', a_label: 'A', b_label: 'B' },
      { driver: true },
    );

    const merge = git(dir, 'merge', '--no-edit', 'other');

    expect(merge.status).not.toBe(0);
    expect(merge.stderr).toContain('dup_label');
    expect(readFileSync(join(dir, CATALOG), 'utf8')).toMatch(/^<<<<<<< /m);
  });

  it('falls back to conflict markers when the checkout has no driver script', () => {
    const dir = forkedRepo(BASE, OURS_APPEND, THEIRS_APPEND, {
      driver: join(tmpdir(), 'missing-i18n-json-merge.mjs'),
    });

    const merge = git(dir, 'merge', '--no-edit', 'other');

    expect(merge.status).not.toBe(0);
    expect(readFileSync(join(dir, CATALOG), 'utf8')).toMatch(/^<<<<<<< /m);
  });

  it('merges a catalog that both branches created', () => {
    const dir = forkedRepo(null, OURS_APPEND, THEIRS_APPEND, { driver: true });

    const merge = git(dir, 'merge', '--no-edit', 'other');

    expect(merge.status, merge.stdout + merge.stderr).toBe(0);
    expect(Object.keys(readCatalog(dir))).toEqual(BOTH_APPENDS);
  });
});

describe('i18n-json-merge resolve', () => {
  it('resolves and stages an append-only conflict left by the default text merge', () => {
    const dir = forkedRepo(BASE, OURS_APPEND, THEIRS_APPEND, { driver: false });
    expect(git(dir, 'merge', '--no-edit', 'other').status).not.toBe(0);

    const resolve = spawnSync(process.execPath, [scriptPath, 'resolve'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(resolve.status, resolve.stderr).toBe(0);
    expect(Object.keys(readCatalog(dir))).toEqual(BOTH_APPENDS);
    expect(gitOk(dir, 'ls-files', '-u')).toBe('');
  });

  it('leaves a same-key conflict unresolved and exits non-zero', () => {
    const dir = forkedRepo(
      BASE,
      { ...BASE, a_label: 'Ours A' },
      { ...BASE, a_label: 'Theirs A' },
      { driver: false },
    );
    expect(git(dir, 'merge', '--no-edit', 'other').status).not.toBe(0);

    const resolve = spawnSync(process.execPath, [scriptPath, 'resolve'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(resolve.status).not.toBe(0);
    expect(resolve.stderr).toContain('a_label');
    expect(gitOk(dir, 'ls-files', '-u', CATALOG)).not.toBe('');
  });
  it('leaves a catalog without conflict markers alone so hand edits survive', () => {
    const dir = forkedRepo(BASE, OURS_APPEND, THEIRS_APPEND, { driver: false });
    expect(git(dir, 'merge', '--no-edit', 'other').status).not.toBe(0);
    const handEdit = serializeCatalog({ ...OURS_APPEND, hand_label: 'Mine' });
    writeFileSync(join(dir, CATALOG), handEdit);

    const resolve = spawnSync(process.execPath, [scriptPath, 'resolve'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(resolve.status).not.toBe(0);
    expect(readFileSync(join(dir, CATALOG), 'utf8')).toBe(handEdit);
  });
});

describe('i18n-json-merge install', () => {
  it('is a no-op outside a git repository so pnpm install never fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-json-merge-nogit-'));
    tempDirs.push(dir);

    const install = spawnSync(process.execPath, [scriptPath, 'install'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
    });

    expect(install.status, install.stderr).toBe(0);
  });
});

describe('mergeCatalogs', () => {
  it('applies one-sided edits and deletions from either side', () => {
    const base = { k1: '1', k2: '2', k3: '3', k4: '4' };
    const result = mergeCatalogs(
      base,
      { k1: 'one', k2: '2', k4: '4' },
      { k1: '1', k2: 'two', k3: '3' },
    );

    expect(result.conflicts).toEqual([]);
    expect(result.entries).toEqual([
      ['k1', 'one'],
      ['k2', 'two'],
    ]);
  });

  it('reports delete-versus-modify and different same-key additions as conflicts', () => {
    const result = mergeCatalogs({ k1: '1' }, { k2: 'ours' }, { k1: 'changed', k2: 'theirs' });

    expect(result.conflicts).toEqual(['k1', 'k2']);
  });

  it('accepts the same addition on both sides once', () => {
    const result = mergeCatalogs({ k1: '1' }, { k1: '1', k2: 'same' }, { k1: '1', k2: 'same' });

    expect(result).toEqual({
      conflicts: [],
      entries: [
        ['k1', '1'],
        ['k2', 'same'],
      ],
    });
  });

  it('keeps a key theirs inserted mid-file next to its theirs neighbour', () => {
    const base = { a: 'a', c: 'c' };
    const result = mergeCatalogs(base, { a: 'a', c: 'c', z: 'z' }, { a: 'a', b: 'b', c: 'c' });

    expect(result.entries.map(([key]) => key)).toEqual(['a', 'b', 'c', 'z']);
  });
});

describe('mergeTexts', () => {
  it('refuses a catalog with a duplicated key instead of dropping one value', () => {
    const dup = '{\n  "k1": "first",\n  "k1": "second"\n}\n';

    expect(mergeTexts('{}', '{}', dup)).toEqual({ error: 'theirs repeats key "k1"' });
  });
});

describe('serializeCatalog', () => {
  it('round-trips every committed locale catalog byte for byte', () => {
    for (const locale of ['de', 'en', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW']) {
      const text = readFileSync(`messages/${locale}.json`, 'utf8');
      expect(serializeCatalog(JSON.parse(text)), locale).toBe(text);
    }
  });
});
