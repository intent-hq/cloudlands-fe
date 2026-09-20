import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CANARY_DIR,
  CANARY_PATHS,
  decideExitCode,
  findMissingCanaries,
  formatCanaryFailure,
  parseKnipJson,
  parseKnipRules,
  renderIssues,
  stripCanaryIssues,
  stripJsonc,
} from './check-dead-code-lib.mjs';

const [CANARY_SVELTE, CANARY_TS] = CANARY_PATHS;
const RULES = { duplicates: 'warn' };

// Shape emitted by `knip --reporter json` (knip 6): one row per file, one array per issue type.
function unusedFile(file: string) {
  return { file, owners: [], files: [{ name: file }] };
}

function duplicateRow(file: string, names: string[]) {
  return {
    file,
    owners: [],
    duplicates: [names.map((name) => ({ name, line: 1, col: 1, pos: 0 }))],
  };
}

function cycleRow(file: string, names: string[]) {
  return { file, owners: [], cycles: [names.map((name) => ({ name, line: 1, col: 1, pos: 0 }))] };
}

const canaryRows = [unusedFile(CANARY_SVELTE), unusedFile(CANARY_TS)];

describe('stripJsonc / parseKnipRules', () => {
  it('strips comments and trailing commas but keeps string contents', () => {
    const text = `{
      // line comment with "quotes" and a trailing, comma
      "entry": ["src/a.ts", "https://x/y"], /* block
      comment */
      "rules": { "duplicates": "warn", },
    }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({
      entry: ['src/a.ts', 'https://x/y'],
      rules: { duplicates: 'warn' },
    });
  });

  it('reads the rules map and defaults to an empty map when absent', () => {
    expect(parseKnipRules('{ "rules": { "duplicates": "warn" } }')).toEqual({ duplicates: 'warn' });
    expect(parseKnipRules('{ "entry": [] }')).toEqual({});
  });
});

describe('parseKnipJson', () => {
  it('returns the issues array', () => {
    expect(parseKnipJson(JSON.stringify({ files: [], issues: canaryRows }))).toEqual(canaryRows);
  });

  it('rejects non-JSON and unexpected shapes with a clear message', () => {
    expect(() => parseKnipJson('not json')).toThrow(/no parseable JSON/);
    expect(() => parseKnipJson('{"foo": 1}')).toThrow(/issues/);
  });
});

describe('canary presence', () => {
  it('passes when both canaries are reported as unused files', () => {
    expect(findMissingCanaries(canaryRows)).toEqual([]);
  });

  it('fails naming the svelte canary when only the ts canary is reported', () => {
    const missing = findMissingCanaries([unusedFile(CANARY_TS)]);
    expect(missing).toEqual([CANARY_SVELTE]);
    const message = formatCanaryFailure(missing);
    expect(message).toContain(CANARY_SVELTE);
    expect(message).toMatch(/resolve\.extensions/);
    expect(message).toMatch(/import\.meta\.glob/);
    expect(message).toMatch(/\.gitignore/);
  });

  it('fails naming the ts canary when only the svelte canary is reported', () => {
    expect(findMissingCanaries([unusedFile(CANARY_SVELTE)])).toEqual([CANARY_TS]);
  });

  it('fails naming both when knip reports nothing', () => {
    expect(findMissingCanaries([])).toEqual([CANARY_SVELTE, CANARY_TS]);
  });
});

describe('stripCanaryIssues + exit decision', () => {
  it('drops only canary rows and exits 0 when nothing else is reported', () => {
    const remaining = stripCanaryIssues(canaryRows);
    expect(remaining).toEqual([]);
    expect(decideExitCode(remaining, RULES)).toBe(0);
    expect(renderIssues(remaining, RULES)).toMatch(/no unused files/);
  });

  it('exits 1 and lists another unused file while hiding the canaries', () => {
    const remaining = stripCanaryIssues([...canaryRows, unusedFile('src/lib/tmp-unused.ts')]);
    expect(remaining).toEqual([unusedFile('src/lib/tmp-unused.ts')]);
    expect(decideExitCode(remaining, RULES)).toBe(1);
    const report = renderIssues(remaining, RULES);
    expect(report).toContain('Unused files (1)');
    expect(report).toContain('src/lib/tmp-unused.ts');
    expect(report).not.toContain(CANARY_DIR);
    expect(report).toMatch(/1 error-level issue/);
  });

  it('exits 0 when only warn-level duplicates remain', () => {
    const remaining = stripCanaryIssues([
      ...canaryRows,
      duplicateRow('src/lib/icons.ts', ['faArchive', 'faBoxArchive']),
    ]);
    expect(decideExitCode(remaining, RULES)).toBe(0);
    const report = renderIssues(remaining, RULES);
    expect(report).toContain('Duplicate exports (1) [warn]');
    expect(report).toContain('src/lib/icons.ts  faArchive|faBoxArchive');
    expect(report).toMatch(/no error-level issues \(1 warning/);
  });

  it('treats duplicates as errors when knip.jsonc does not downgrade them', () => {
    const remaining = [duplicateRow('src/lib/icons.ts', ['a', 'b'])];
    expect(decideExitCode(remaining, {})).toBe(1);
  });

  it('follows knip and treats unconfigured cycles as warnings', () => {
    const remaining = [cycleRow('src/a.ts', ['src/a.ts', 'src/b.ts'])];
    expect(decideExitCode(remaining, {})).toBe(0);
    const report = renderIssues(remaining, {});
    expect(report).toContain('Circular dependencies (1) [warn]');
    expect(report).toMatch(/no error-level issues \(1 warning/);
  });

  it('lets knip.jsonc promote cycles to errors', () => {
    const remaining = [cycleRow('src/a.ts', ['src/a.ts', 'src/b.ts'])];
    expect(decideExitCode(remaining, { cycles: 'error' })).toBe(1);
  });

  it('renders export issues with file, symbol and position', () => {
    const rows = [
      { file: 'src/a.ts', owners: [], exports: [{ name: 'foo', line: 3, col: 14, pos: 40 }] },
    ];
    const report = renderIssues(rows, RULES);
    expect(report).toContain('Unused exports (1)');
    expect(report).toContain('src/a.ts  foo:3:14');
  });
});

describe('check-dead-code CLI cleanup', () => {
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-dead-code.mjs');

  // The real CLI runs against a throwaway root (via CHECK_DEAD_CODE_ROOT) so the test never
  // touches the live checkout's canary directory, which a concurrent `lint:dead-code` may own.
  function writeFixtureRoot(dir: string): string {
    const root = path.join(dir, 'root');
    mkdirSync(path.join(root, path.dirname(CANARY_DIR)), { recursive: true });
    writeFileSync(path.join(root, 'knip.jsonc'), '{ "rules": { "duplicates": "warn" } }\n');
    return root;
  }

  // Makes the second canary write fail (ENOSPC) before knip is ever spawned. The patch is
  // applied through `--import` and `syncBuiltinESMExports` so the CLI's named
  // `writeFileSync` import observes it.
  function writeFailingPreload(dir: string): string {
    const preload = path.join(dir, 'fail-second-canary-write.mjs');
    writeFileSync(
      preload,
      [
        "import fs from 'node:fs';",
        "import { syncBuiltinESMExports } from 'node:module';",
        'const original = fs.writeFileSync;',
        'fs.writeFileSync = function (file, ...rest) {',
        `  if (String(file).endsWith(${JSON.stringify(path.basename(CANARY_TS))})) {`,
        "    const error = new Error('ENOSPC: no space left on device, write');",
        "    error.code = 'ENOSPC';",
        '    throw error;',
        '  }',
        '  return original.call(this, file, ...rest);',
        '};',
        'syncBuiltinESMExports();',
        '',
      ].join('\n'),
    );
    return preload;
  }

  it('removes the canary directory and exits nonzero when a canary write fails', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'check-dead-code-'));
    try {
      const fixtureRoot = writeFixtureRoot(tmp);
      const preload = writeFailingPreload(tmp);
      const result = spawnSync(process.execPath, ['--import', preload, cliPath], {
        cwd: fixtureRoot,
        env: { ...process.env, CHECK_DEAD_CODE_ROOT: fixtureRoot },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('ENOSPC');
      expect(existsSync(path.join(fixtureRoot, CANARY_DIR))).toBe(false);
      expect(existsSync(path.join(fixtureRoot, path.dirname(CANARY_DIR)))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
