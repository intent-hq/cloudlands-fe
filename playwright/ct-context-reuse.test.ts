import { describe, expect, it } from 'vitest';
import { resolveCtContextReuseMode } from './ct-context-reuse';

describe('resolveCtContextReuseMode', () => {
  it('defaults to none when CT_CONTEXT_REUSE is unset', () => {
    expect(resolveCtContextReuseMode({ env: {} })).toBe('none');
    expect(resolveCtContextReuseMode({ env: { CI: 'true' } })).toBe('none');
  });

  it.each(['1', ' 1', '1 ', '\t1\n'])('enables reuse for CT_CONTEXT_REUSE=%j', (raw) => {
    expect(resolveCtContextReuseMode({ env: { CT_CONTEXT_REUSE: raw } })).toBe('when-possible');
  });

  it.each(['', ' ', '\n'])('treats blank CT_CONTEXT_REUSE %j as unset', (raw) => {
    expect(resolveCtContextReuseMode({ env: { CT_CONTEXT_REUSE: raw } })).toBe('none');
  });

  it.each(['0', 'true', 'yes', 'on', '11', '1.0', 'when-possible', 'none', 'junk'])(
    'keeps the default for unrecognized CT_CONTEXT_REUSE %j',
    (raw) => {
      expect(resolveCtContextReuseMode({ env: { CT_CONTEXT_REUSE: raw } })).toBe('none');
    },
  );
});
