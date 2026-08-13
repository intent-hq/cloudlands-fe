import { describe, expect, it } from 'vitest';
import {
  MIN_FILES,
  evaluateRun,
  formatDiagnostic,
  parseMachineLine,
} from './run-svelte-check.mjs';

describe('parseMachineLine', () => {
  it('parses a COMPLETED summary line', () => {
    const event = parseMachineLine('1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS');
    expect(event).toEqual({
      kind: 'completed',
      files: 4400,
      errors: 0,
      warnings: 2,
      filesWithProblems: 1,
    });
  });

  it('parses machine-verbose JSON diagnostics', () => {
    const diagnostic = {
      type: 'ERROR',
      filename: 'src/lib/Foo.svelte',
      start: { line: 11, character: 4 },
      end: { line: 11, character: 7 },
      message: "Cannot find name 'bar'",
      code: 2304,
      source: 'ts',
    };
    const event = parseMachineLine(`1590680326283 ${JSON.stringify(diagnostic)}`);
    expect(event).toEqual({ kind: 'diagnostic', diagnostic });
  });

  it('recognizes START and FAILURE lines', () => {
    expect(parseMachineLine('1590680326283 START "/repo"')).toEqual({ kind: 'start' });
    expect(parseMachineLine('1590680326283 FAILURE "boom"')).toEqual({
      kind: 'failure',
      message: '"boom"',
    });
  });

  it('returns null for non-machine lines and unknown for unrecognized bodies', () => {
    expect(parseMachineLine('Loading svelte-check…')).toBeNull();
    expect(parseMachineLine('1590680326283 SOMETHING ELSE')).toEqual({
      kind: 'unknown',
      body: 'SOMETHING ELSE',
    });
  });
});

describe('formatDiagnostic', () => {
  it('renders a human-readable diagnostic with relative path and 1-based position', () => {
    const out = formatDiagnostic(
      {
        type: 'ERROR',
        filename: '/repo/src/lib/Foo.svelte',
        start: { line: 11, character: 4 },
        message: "Cannot find name 'bar'",
        source: 'ts',
      },
      '/repo',
    );
    expect(out).toBe("src/lib/Foo.svelte:12:5\nError: Cannot find name 'bar' (ts)\n");
  });
});

describe('evaluateRun', () => {
  const completed = { kind: 'completed', files: 4400, errors: 0, warnings: 0, filesWithProblems: 0 };

  it('accepts a plausible clean run', () => {
    expect(evaluateRun({ exitCode: 0, completed })).toEqual([]);
  });

  it('defers to svelte-check when it already failed', () => {
    expect(evaluateRun({ exitCode: 1, completed: { ...completed, files: 3 } })).toEqual([]);
  });

  it('fails an exit-0 run with an implausibly low file count', () => {
    const failures = evaluateRun({ exitCode: 0, completed: { ...completed, files: 3 } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('3 checked files');
    expect(failures[0]).toContain(String(MIN_FILES));
  });

  it('fails an exit-0 run that never reported completion', () => {
    const failures = evaluateRun({ exitCode: 0, completed: null });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('COMPLETED');
  });

  it('fails an exit-0 run that still reported errors', () => {
    const failures = evaluateRun({ exitCode: 0, completed: { ...completed, errors: 2 } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('2 errors');
  });
});
