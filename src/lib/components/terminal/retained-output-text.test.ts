import { describe, expect, it } from 'vitest';
import {
  liveOutputCoversSnapshot,
  retainedOutputIsComplete,
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

describe('liveOutputCoversSnapshot', () => {
  const capped = (body: string) => `[showing last 2 of 9 lines]\n${body}`;

  it('accepts live output that already holds the start of the snapshot', () => {
    const live = 'line 1\n\x1b[32mline 2\x1b[0m\nline 3\n';
    expect(liveOutputCoversSnapshot(live, capped('\x1b[32mline 2\x1b[0m\nline 3\n'))).toBe(true);
    // The read can also hold output logged after the live position.
    expect(liveOutputCoversSnapshot(live, capped('line 3\nline 4\n'))).toBe(true);
  });

  it('rejects live output that misses part of the snapshot', () => {
    expect(liveOutputCoversSnapshot('', capped('line 2\n'))).toBe(false);
    expect(liveOutputCoversSnapshot('line 3\n', capped('line 2\nline 3\n'))).toBe(false);
    expect(liveOutputCoversSnapshot('line 2\nother\n', capped('line 2\nline 3\n'))).toBe(false);
  });
});
