import { describe, expect, it } from 'vitest';
import { retainedOutputTerminalText } from './retained-output-text';

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
