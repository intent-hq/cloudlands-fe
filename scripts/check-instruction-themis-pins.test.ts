import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInstructionThemisPinViolations } from './check-instruction-themis-pins.mjs';

const instructionFile = (path: string, lines: string[]) => ({ path, content: lines.join('\n') });

const scriptPath = join(process.cwd(), 'scripts/check-instruction-themis-pins.mjs');
const STALE_PIN = '`@augmentcode/themis@0.1.1` is the canonical Store implementation.\n';
const CLEAN = 'Use the `@augmentcode/themis` version declared in `package.json`.\n';

function git(cwd: string, args: string[], input?: string) {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  });
}

// Index entries without working-tree files: the listing grows past
// `execFileSync`'s default 1 MiB `maxBuffer` without writing thousands of files.
function addIndexEntries(cwd: string, count: number, pathLength: number) {
  const blob = git(cwd, ['hash-object', '-w', '--stdin'], 'placeholder\n').trim();
  const entries = Array.from({ length: count }, (_, index) => {
    const name = `${index}`.padStart(pathLength - 'padding/.ts'.length, 'x');
    return `100644 blob ${blob}\tpadding/${name}.ts`;
  });
  git(cwd, ['update-index', '--add', '--index-info'], `${entries.join('\n')}\n`);
}

function writeFiles(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
}

function withRepo(
  files: Record<string, string>,
  run: (dir: string) => void,
  { init = true }: { init?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'themis-pins-gate-'));
  try {
    if (init) git(dir, ['init', '-q']);
    writeFiles(dir, files);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGate(cwd: string) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('instruction Themis pin guard', () => {
  it('passes an instruction file that refers to the package.json version', () => {
    const files = [
      instructionFile('src/store/renderer/AGENTS.md', [
        '# Redux Store — Agent Directives',
        '',
        '> The `@augmentcode/themis` version declared in `package.json` is the canonical',
        '> Store implementation.',
        '',
        '- Import helpers from `@augmentcode/themis/utils/collections/collection-utils`.',
        "import { createAction } from '@augmentcode/themis/utils/store/create-action';",
      ]),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([]);
  });

  it('flags a literal version pin with its path and line', () => {
    const files = [
      instructionFile('src/store/renderer/AGENTS.md', [
        '# Redux Store — Agent Directives',
        '',
        '> `@augmentcode/themis@0.1.1` is the canonical Store implementation.',
      ]),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([
      { path: 'src/store/renderer/AGENTS.md', line: 3, match: '@augmentcode/themis@0.1.1' },
    ]);
  });

  it('flags a pin even when it matches the installed version', () => {
    const files = [instructionFile('AGENTS.md', ['Use `@augmentcode/themis@0.2.5` everywhere.'])];
    expect(findInstructionThemisPinViolations(files)).toHaveLength(1);
    expect(findInstructionThemisPinViolations(files)[0]).toMatchObject({
      line: 1,
      match: '@augmentcode/themis@0.2.5',
    });
  });

  it.each([
    ['a bare package reference', 'The `@augmentcode/themis` package owns the Store.'],
    [
      'a subpath import',
      "import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';",
    ],
    ['a subpath reference in prose', 'Reference: `@augmentcode/themis/utils/store/create-action`.'],
  ])('does not flag %s', (_name, line) => {
    expect(
      findInstructionThemisPinViolations([instructionFile('src/features/AGENTS.md', [line])]),
    ).toEqual([]);
  });

  it('ignores files that are not AGENTS.md', () => {
    const files = [
      instructionFile('CHANGELOG.md', ['- bump to `@augmentcode/themis@0.2.5`']),
      instructionFile('package.json', ['"@augmentcode/themis@0.2.5"']),
      instructionFile('src/store/renderer/docs/AGENTS.md.bak', ['`@augmentcode/themis@0.1.1`']),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([]);
  });

  it('reports every pin across lines and files in order', () => {
    const files = [
      instructionFile('AGENTS.md', [
        'ok',
        '`@augmentcode/themis@0.1.1`',
        'ok',
        '`@augmentcode/themis@next`',
      ]),
      instructionFile('src/AGENTS.md', ['`@augmentcode/themis@^0.2.0`']),
    ];
    expect(findInstructionThemisPinViolations(files)).toEqual([
      { path: 'AGENTS.md', line: 2, match: '@augmentcode/themis@0.1.1' },
      { path: 'AGENTS.md', line: 4, match: '@augmentcode/themis@next' },
      { path: 'src/AGENTS.md', line: 1, match: '@augmentcode/themis@^0.2.0' },
    ]);
  });
});

// The CLI walks the tree it is run from. It must honor the repository's ignore
// rules and nested repository boundaries (intent-hq/intent#4808: a gitignored
// `.demo-artifacts/verify-*` worktree carried a stale pin the product tree had
// already removed) while still auditing tracked and ordinary untracked files.
describe('instruction Themis pin guard CLI traversal', () => {
  it('audits tracked and ordinary untracked AGENTS.md files', () => {
    withRepo({ 'src/store/AGENTS.md': STALE_PIN, 'src/features/AGENTS.md': STALE_PIN }, (dir) => {
      git(dir, ['add', 'src/store/AGENTS.md']);
      const result = runGate(dir);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('src/store/AGENTS.md:1: @augmentcode/themis@0.1.1');
      expect(result.output).toContain('src/features/AGENTS.md:1: @augmentcode/themis@0.1.1');
    });
  });

  it('skips a gitignored nested checkout carrying a stale pin', () => {
    withRepo(
      {
        '.gitignore': '.demo-artifacts/\n',
        'AGENTS.md': CLEAN,
        '.demo-artifacts/verify-2298.256rAJ/src/store/renderer/AGENTS.md': STALE_PIN,
      },
      (dir) => {
        git(join(dir, '.demo-artifacts/verify-2298.256rAJ'), ['init', '-q']);
        const result = runGate(dir);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(result.output).toContain('1 AGENTS.md files');
      },
    );
  });

  it('skips gitignored instruction files outside any nested checkout', () => {
    withRepo(
      { '.gitignore': '.dev/\n', 'AGENTS.md': CLEAN, '.dev/probe/AGENTS.md': STALE_PIN },
      (dir) => {
        expect(runGate(dir)).toMatchObject({ exitCode: 0 });
      },
    );
  });

  it('does not cross into a nested repository that is not ignored', () => {
    withRepo({ 'AGENTS.md': CLEAN, 'vendor/other/AGENTS.md': STALE_PIN }, (dir) => {
      git(join(dir, 'vendor/other'), ['init', '-q']);
      expect(runGate(dir)).toMatchObject({ exitCode: 0 });
    });
  });

  it('ignores a nested repository directory named after the instruction file', () => {
    withRepo({ 'AGENTS.md': CLEAN, 'vendor/AGENTS.md/README.md': STALE_PIN }, (dir) => {
      git(join(dir, 'vendor/AGENTS.md'), ['init', '-q']);
      const result = runGate(dir);
      expect(result).toMatchObject({ exitCode: 0 });
      expect(result.output).toContain('1 AGENTS.md files');
    });
  });

  it('still skips ignored artifacts when the index listing exceeds 1 MiB', () => {
    withRepo(
      {
        '.gitignore': '.demo-artifacts/\n',
        'AGENTS.md': CLEAN,
        '.demo-artifacts/old/AGENTS.md': STALE_PIN,
      },
      (dir) => {
        addIndexEntries(dir, 6000, 200);
        expect(git(dir, ['ls-files', '-z']).length).toBeGreaterThan(1024 * 1024);
        const result = runGate(dir);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(result.output).toContain('1 AGENTS.md files');
      },
    );
  });

  it('reports a Git failure other than a missing repository instead of walking the tree', () => {
    withRepo({ 'AGENTS.md': CLEAN, '.demo-artifacts/old/AGENTS.md': STALE_PIN }, (dir) => {
      writeFileSync(join(dir, '.git/index'), 'corrupt index');
      const result = runGate(dir);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).not.toContain('.demo-artifacts/old/AGENTS.md');
      expect(result.output).toMatch(/index/i);
    });
  });

  it('flags an ordinary nested untracked AGENTS.md with a stale pin', () => {
    withRepo(
      {
        '.gitignore': '.demo-artifacts/\n',
        'AGENTS.md': CLEAN,
        'src/store/renderer/AGENTS.md': STALE_PIN,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain(
          'src/store/renderer/AGENTS.md:1: @augmentcode/themis@0.1.1',
        );
      },
    );
  });

  it('falls back to a filesystem walk outside a Git repository', () => {
    withRepo(
      { 'AGENTS.md': CLEAN, 'src/AGENTS.md': STALE_PIN, 'node_modules/pkg/AGENTS.md': STALE_PIN },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('src/AGENTS.md:1: @augmentcode/themis@0.1.1');
        expect(result.output).not.toContain('node_modules');
      },
      { init: false },
    );
  });
});
