// @verify-changed-triggers: tsconfig*.json
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CANARY_DIR,
  CANARY_PATHS,
  CANARY_TSCONFIG_EXCLUDE,
  decideExitCode,
  findMissingCanaries,
  formatCanaryFailure,
  parseKnipJson,
  parseKnipRules,
  renderIssues,
  stripCanaryIssues,
  stripJsonc,
} from './check-dead-code-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// The gate writes and deletes the canary files while it runs. A `tsc` overlapping that
// window (`pnpm run type-check` next to `pnpm run lint:dead-code`) enumerates the files
// on startup and fails with TS6053 when they are gone by the time it reads them, so every
// root tsconfig that would pick them up has to exclude them (cloudlands-fe#2724).
//
// TypeScript's own config parser is the oracle: generic glob matchers disagree with tsc on
// brace/extglob patterns, single-star depth and how inherited patterns are rebased, so the
// checks below resolve each config exactly the way `tsc` / `svelte-check` do.
describe('tsconfig excludes the canary directory', () => {
  // svelte-check registers `.svelte` like this before asking TypeScript for the file list, so
  // the resolved set is what svelte-check compiles (a superset of what `tsc` compiles).
  const SVELTE_EXTENSION: ts.FileExtensionInfo = {
    extension: 'svelte',
    isMixedContent: true,
    scriptKind: ts.ScriptKind.Deferred,
  };
  // TS18003 "No inputs were found" is the expected outcome when nothing but the canaries exists.
  const NO_INPUTS_FOUND = 18003;

  type ConfigFiles = Record<string, string | object>;
  const BOTH_CANARIES = [...CANARY_PATHS].sort();

  // Resolves `entry` with TypeScript's config parser inside a throwaway root whose only source
  // files are the two canaries, and returns the canary paths TypeScript would compile.
  function resolveCanaries(configs: ConfigFiles, entry: string): string[] {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'canary-tsconfig-')));
    try {
      for (const canary of CANARY_PATHS) {
        mkdirSync(path.join(root, path.dirname(canary)), { recursive: true });
        writeFileSync(path.join(root, canary), '');
      }
      for (const [name, content] of Object.entries(configs)) {
        mkdirSync(path.join(root, path.dirname(name)), { recursive: true });
        writeFileSync(
          path.join(root, name),
          typeof content === 'string' ? content : JSON.stringify(content),
        );
      }
      const configPath = path.join(root, entry);
      const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
      if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
      const parsed = ts.parseJsonConfigFileContent(
        config,
        ts.sys,
        path.dirname(configPath),
        undefined,
        configPath,
        undefined,
        [SVELTE_EXTENSION],
      );
      const problems = parsed.errors
        .filter((diagnostic) => diagnostic.code !== NO_INPUTS_FOUND)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      if (problems.length > 0) {
        throw new Error(`${entry} did not parse cleanly:\n${problems.join('\n')}`);
      }
      return parsed.fileNames
        .map((file) => path.relative(root, file))
        .filter((file) => CANARY_PATHS.includes(file))
        .sort();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function withInclude(include: string[], exclude?: string[]): string[] {
    return resolveCanaries({ 'tsconfig.json': { include, exclude } }, 'tsconfig.json');
  }

  const rootConfigs = readdirSync(REPO_ROOT)
    .filter((name) => /^tsconfig.*\.json$/.test(name))
    .sort();
  // Copied together so `extends` between root configs keeps resolving inside the throwaway root.
  const rootConfigFiles: ConfigFiles = Object.fromEntries(
    rootConfigs.map((name) => [name, readFileSync(path.join(REPO_ROOT, name), 'utf8')]),
  );

  it('the shared exclude glob removes both canaries from a config that compiles src', () => {
    expect(withInclude(['src/**/*'])).toEqual(BOTH_CANARIES);
    expect(withInclude(['src/**/*'], [CANARY_TSCONFIG_EXCLUDE])).toEqual([]);
  });

  it('the renderer tsconfig would otherwise include the canary, so the exclude is load-bearing', () => {
    expect(rootConfigs).toContain('tsconfig.json');
    const config = JSON.parse(stripJsonc(rootConfigFiles['tsconfig.json'] as string));
    expect(config.exclude).toContain(CANARY_TSCONFIG_EXCLUDE);
    config.exclude = config.exclude.filter((entry: string) => entry !== CANARY_TSCONFIG_EXCLUDE);
    expect(
      resolveCanaries({ ...rootConfigFiles, 'tsconfig.json': config }, 'tsconfig.json'),
    ).toEqual(BOTH_CANARIES);
  });

  it.each(rootConfigs)('%s does not compile any canary file', (name) => {
    expect(
      resolveCanaries(rootConfigFiles, name),
      `${name} compiles the canary; add ${JSON.stringify(CANARY_TSCONFIG_EXCLUDE)} to its "exclude"`,
    ).toEqual([]);
  });

  // Patterns a generic glob matcher accepts but TypeScript reads literally: the canaries stay
  // included, so an exclude written this way must fail the checks above.
  it.each([
    ['brace expansion', `${CANARY_DIR}/*.{ts,svelte}`],
    ['extglob', `${CANARY_DIR}/*.@(ts|svelte)`],
  ])('an exclude using %s does not cover the canaries', (_syntax, exclude) => {
    expect(withInclude(['src/**/*'], [exclude])).toEqual(BOTH_CANARIES);
  });

  it('a single-star include is not recursive', () => {
    expect(withInclude(['src/*'])).toEqual([]);
    expect(withInclude([`${CANARY_DIR}/*`])).toEqual(BOTH_CANARIES);
  });

  it('inherited patterns are relative to the config that declares them', () => {
    const child = { extends: './config/base.json', include: ['src/**/*'] };
    const withBaseExclude = (exclude: string) =>
      resolveCanaries(
        { 'tsconfig.json': child, 'config/base.json': { exclude: [exclude] } },
        'tsconfig.json',
      );
    expect(withBaseExclude(CANARY_TSCONFIG_EXCLUDE)).toEqual(BOTH_CANARIES);
    expect(withBaseExclude(`../${CANARY_TSCONFIG_EXCLUDE}`)).toEqual([]);
  });

  it('a config that fails to parse fails the check instead of passing silently', () => {
    expect(() =>
      resolveCanaries(
        { 'tsconfig.json': { extends: './missing.json', include: ['src/**/*'] } },
        'tsconfig.json',
      ),
    ).toThrow(/missing\.json/);
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
