import { describe, expect, it } from 'vitest';
import {
  MIN_FILES,
  createOutputCollector,
  evaluateRun,
  formatDiagnostic,
  parseMachineLine,
  syncEnv,
} from './run-svelte-check.mjs';

describe('parseMachineLine', () => {
  it('parses a COMPLETED summary line', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS',
    );
    expect(event).toEqual({
      kind: 'completed',
      files: 4400,
      errors: 0,
      warnings: 2,
      filesWithProblems: 1,
    });
  });

  it('parses a COMPLETED line with trailing whitespace or CR', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS\r',
    );
    expect(event).toMatchObject({ kind: 'completed', files: 4400 });
  });

  it('parses a legacy COMPLETED line without the FILES_WITH_PROBLEMS clause', () => {
    const event = parseMachineLine('1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS');
    expect(event).toEqual({
      kind: 'completed',
      files: 4400,
      errors: 0,
      warnings: 2,
      filesWithProblems: 0,
    });
  });

  it('rejects a COMPLETED line with unexpected extra trailing fields', () => {
    const event = parseMachineLine(
      '1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS 3 HINTS',
    );
    expect(event).toEqual({
      kind: 'unknown',
      body: 'COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS 3 HINTS',
    });
  });

  it('parses a COMPLETED record without the epoch timestamp prefix', () => {
    expect(
      parseMachineLine('COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS'),
    ).toMatchObject({ kind: 'completed', files: 4400 });
  });

  it('keeps prefix-less non-COMPLETED lines as passthrough', () => {
    expect(parseMachineLine('START "/repo"')).toBeNull();
    expect(parseMachineLine('FAILURE "boom"')).toBeNull();
    expect(parseMachineLine('{"type":"ERROR","message":"x"}')).toBeNull();
  });

  it('does not treat a truncated COMPLETED line as a completion', () => {
    expect(parseMachineLine('1590680326283 COMPLETED 4400 FILES 0 ERR')).toEqual({
      kind: 'unknown',
      body: 'COMPLETED 4400 FILES 0 ERR',
    });
    expect(parseMachineLine('COMPLETED 4400 FI')).toBeNull();
  });

  it('rejects a COMPLETED line truncated after the WARNINGS clause', () => {
    for (const tail of ['1', '1 FI', '1 FILES_WITH_PROB']) {
      expect(
        parseMachineLine(`1590680326283 COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS ${tail}`),
      ).toEqual({
        kind: 'unknown',
        body: `COMPLETED 4400 FILES 0 ERRORS 2 WARNINGS ${tail}`,
      });
    }
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

describe('syncEnv', () => {
  it('forces NODE_ENV to development so sync typegen covers src/routes', () => {
    expect(syncEnv({ NODE_ENV: 'production', PATH: '/bin' })).toEqual({
      NODE_ENV: 'development',
      PATH: '/bin',
    });
  });

  it('sets NODE_ENV even when absent', () => {
    expect(syncEnv({ PATH: '/bin' })).toEqual({ NODE_ENV: 'development', PATH: '/bin' });
  });
});

describe('createOutputCollector', () => {
  const completedLine =
    '1590680326283 COMPLETED 4760 FILES 0 ERRORS 2 WARNINGS 1 FILES_WITH_PROBLEMS';

  it('records the COMPLETED summary from a current-format stream and passes the guard', () => {
    const printed: string[] = [];
    const collector = createOutputCollector({
      print: (line: string) => printed.push(line),
      printError: () => {},
      workspaceDir: '/repo',
    });
    for (const line of ['1590680326283 START "/repo"', completedLine]) {
      collector.handleLine(line);
    }
    expect(collector.completed).toMatchObject({ kind: 'completed', files: 4760, errors: 0 });
    expect(evaluateRun({ exitCode: 0, completed: collector.completed })).toEqual([]);
  });

  it('re-prints diagnostics and passthrough lines without recording completion', () => {
    const printed: string[] = [];
    const collector = createOutputCollector({
      print: (line: string) => printed.push(line),
      printError: () => {},
      workspaceDir: '/repo',
    });
    const diagnostic = {
      type: 'ERROR',
      filename: 'src/lib/Foo.svelte',
      start: { line: 11, character: 4 },
      message: "Cannot find name 'bar'",
      source: 'ts',
    };
    collector.handleLine('Loading svelte-check…');
    collector.handleLine(`1590680326283 ${JSON.stringify(diagnostic)}`);
    expect(printed[0]).toBe('Loading svelte-check…');
    expect(printed[1]).toContain('src/lib/Foo.svelte:12:5');
    expect(collector.completed).toBeNull();
  });

  it('fails the guard on a truncated stream that never completes', () => {
    const collector = createOutputCollector({ print: () => {}, printError: () => {} });
    for (const line of ['1590680326283 START "/repo"', '1590680326283 COMPLETED 4760 FIL']) {
      collector.handleLine(line);
    }
    expect(collector.completed).toBeNull();
    const failures = evaluateRun({ exitCode: 0, completed: collector.completed });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('COMPLETED');
  });

  it('defers to a failing check (nonzero exit) without inventing guard failures', () => {
    const collector = createOutputCollector({ print: () => {}, printError: () => {} });
    collector.handleLine(
      '1590680326283 COMPLETED 4760 FILES 3 ERRORS 0 WARNINGS 2 FILES_WITH_PROBLEMS',
    );
    expect(collector.completed).toMatchObject({ errors: 3 });
    expect(evaluateRun({ exitCode: 1, completed: collector.completed })).toEqual([]);
  });
});

describe('evaluateRun', () => {
  const completed = {
    kind: 'completed',
    files: 4400,
    errors: 0,
    warnings: 0,
    filesWithProblems: 0,
  };

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
