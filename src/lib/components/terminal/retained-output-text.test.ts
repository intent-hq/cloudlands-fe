import { describe, expect, it } from 'vitest';
import {
  retainedOutputIsComplete,
  snapshotRemainderAfterLive,
  retainedOutputTerminalText,
} from './retained-output-text';

describe('retainedOutputTerminalText', () => {
  it('drops the whole-log line count header', () => {
    expect(retainedOutputTerminalText('[3 lines]\n\x1b[32mok\x1b[0m\nnext')).toBe(
      '\x1b[32mok\x1b[0m\nnext',
    );
  });

  it('keeps an omission header as a dim line', () => {
    expect(retainedOutputTerminalText('[showing last 2 of 5 lines]\na\nb')).toBe(
      '\x1b[2m[showing last 2 of 5 lines]\x1b[22m\na\nb',
    );
    expect(
      retainedOutputTerminalText(
        '[showing last 1 of 9 lines; older output omitted to fit the reply size limit]\nz',
      ),
    ).toBe(
      '\x1b[2m[showing last 1 of 9 lines; older output omitted to fit the reply size limit]\x1b[22m\nz',
    );
  });

  it('leaves text without a leading header untouched', () => {
    expect(retainedOutputTerminalText('tail of a cut log\n[2 lines]\n')).toBe(
      'tail of a cut log\n[2 lines]\n',
    );
    expect(retainedOutputTerminalText('[build] done\n')).toBe('[build] done\n');
  });

  it('returns nothing for a header-only log', () => {
    expect(retainedOutputTerminalText('[0 lines]\n')).toBe('');
  });
});

describe('retainedOutputIsComplete', () => {
  it('accepts only a snapshot that holds the whole run log', () => {
    expect(retainedOutputIsComplete('[2 lines]\na\nb')).toBe(true);
    expect(retainedOutputIsComplete('[showing last 2 of 5 lines]\na\nb')).toBe(false);
    expect(
      retainedOutputIsComplete(
        '[showing last 1 of 9 lines; older output omitted to fit the reply size limit]\nz',
      ),
    ).toBe(false);
    // The renderer keeps only the tail of an oversized reply, which cuts the header off.
    expect(retainedOutputIsComplete('tail of a cut reply\n')).toBe(false);
  });
});

describe('snapshotRemainderAfterLive', () => {
  const capped = (body: string) => `[showing last 2 of 9 lines]\n${body}`;

  it('returns nothing more when live output already holds the whole snapshot', () => {
    const live = 'line 1\n\x1b[32mline 2\x1b[0m\nline 3\n';
    expect(snapshotRemainderAfterLive(live, capped('\x1b[32mline 2\x1b[0m\nline 3\n'))).toBe('');
  });

  it('finds the whole snapshot in a long run of repeated lines', () => {
    const live = `diagnostic\n${'heartbeat\n'.repeat(3000)}done\n`;
    expect(snapshotRemainderAfterLive(live, capped(`${'heartbeat\n'.repeat(2500)}done\n`))).toBe(
      '',
    );
  });

  it('returns the snapshot part that live output does not hold', () => {
    expect(snapshotRemainderAfterLive('line 2\nline 3\n', capped('line 3\nline 4\n'))).toBe(
      'line 4\n',
    );
    // A repeated line must not hide output that only the snapshot holds.
    expect(
      snapshotRemainderAfterLive('heartbeat\n', capped('heartbeat\ndiagnostic\nheartbeat\n')),
    ).toBe('diagnostic\nheartbeat\n');
    // The longest overlap wins, so less output repeats.
    expect(snapshotRemainderAfterLive('A\nB\nA\n', capped('A\nB\nA\nC\n'))).toBe('C\n');
  });

  it('returns undefined when live output does not reach the snapshot start', () => {
    expect(snapshotRemainderAfterLive('', capped('line 2\n'))).toBeUndefined();
    expect(snapshotRemainderAfterLive('line 3\n', capped('line 2\nline 3\n'))).toBeUndefined();
    expect(
      snapshotRemainderAfterLive('line 2\nother\n', capped('line 2\nline 3\n')),
    ).toBeUndefined();
  });
});
