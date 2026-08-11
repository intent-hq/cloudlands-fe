import { describe, expect, it } from 'vitest';
import { supportsReasoningEffortProtocol } from './reasoning-effort-protocol';

describe('supportsReasoningEffortProtocol', () => {
  it.each([
    ['5.2', true],
    ['5.2.0', true],
    ['6.1', true],
    ['5.1', false],
    ['4.9', false],
    ['invalid', false],
    [undefined, false],
  ])('returns %s support as %s', (version, expected) => {
    expect(supportsReasoningEffortProtocol(version)).toBe(expected);
  });
});
