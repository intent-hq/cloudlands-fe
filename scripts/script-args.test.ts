// @verify-changed-triggers: scripts/**/*.{js,mjs,cjs,ts}
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scriptArgs } from './script-args.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptsDir);

// A string literal (not a comment) naming an unknown argument, option or flag.
const UNKNOWN_ARG_STRING = /[`'"][^`'"\n]*\bunknown (?:or \w+ )?(?:argument|option|flag)/i;
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
const IMPORTS_HELPER =
  /import\s*\{[^}]*\bscriptArgs\b[^}]*\}\s*from\s*['"](?:\.\.?\/)+script-args\.mjs['"]/;

function rejectsUnknownArgs(source: string) {
  return source
    .split('\n')
    .some((line) => !COMMENT_LINE.test(line) && UNKNOWN_ARG_STRING.test(line));
}

function missesScriptArgs(source: string) {
  return (
    rejectsUnknownArgs(source) && !(IMPORTS_HELPER.test(source) && /\bscriptArgs\(/.test(source))
  );
}

function scriptSources() {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'scripts'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return listed
    .split('\0')
    .filter((file) => /\.(?:[cm]?js|[cm]?ts)$/.test(file) && !/\.test\.[cm]?[jt]s$/.test(file))
    .map((file) => ({ file, source: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('scriptArgs', () => {
  it.each([
    [['--', '--check'], ['--check']],
    [
      ['--follow', '--', '--port', '1'],
      ['--follow', '--port', '1'],
    ],
    [
      ['--', 'a.ct.spec.ts', '--', '--grep', 'x'],
      ['a.ct.spec.ts', '--', '--grep', 'x'],
    ],
    [['--', '--'], ['--']],
    [['--'], []],
    [[], []],
  ])('maps %j to %j', (input, expected) => {
    expect(scriptArgs(input)).toEqual(expected);
  });

  it('does not mutate its input', () => {
    const input = ['--', '--check'];
    scriptArgs(input).push('--extra');
    expect(input).toEqual(['--', '--check']);
  });

  it('drops the separator pnpm forwards to a real script process', () => {
    const run = spawnSync(
      process.execPath,
      ['scripts/check-fixture-protocol-versions.mjs', '--', '--bogus'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Unknown argument(s): --bogus\n');
  });

  it('drops the separator after flags baked into a package.json script', () => {
    const run = spawnSync(
      process.execPath,
      ['scripts/observe-memory.js', '--follow', '--', '--help'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});

describe('scripts that reject unknown arguments use scriptArgs', () => {
  it('flags a parser that throws on unknown arguments without the helper', () => {
    const parser =
      'for (const arg of process.argv.slice(2)) throw new Error(`Unknown option: ${arg}`);';
    expect(missesScriptArgs(parser)).toBe(true);
    expect(
      missesScriptArgs(
        `import { scriptArgs } from './script-args.mjs';\n${parser.replace('process.argv.slice(2)', 'scriptArgs()')}`,
      ),
    ).toBe(false);
    expect(missesScriptArgs('usage(`unknown option ${arg}`);')).toBe(true);
    expect(missesScriptArgs('throw new Error(`Unknown or incomplete option: ${arg}`);')).toBe(true);
    expect(missesScriptArgs('// Unknown options are forwarded unchanged.')).toBe(false);
    expect(missesScriptArgs(' * after `--`: npm drops unknown flags before it')).toBe(false);
  });

  it('covers every script under scripts/', () => {
    const sources = scriptSources();
    expect(sources.filter(({ source }) => rejectsUnknownArgs(source)).length).toBeGreaterThan(10);
    const offenders = sources
      .filter(({ source }) => missesScriptArgs(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'Strip the `--` that `pnpm run <script> -- --flag` forwards: parse scriptArgs() from scripts/script-args.mjs.',
    ).toEqual([]);
  });
});
