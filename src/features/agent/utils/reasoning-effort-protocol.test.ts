import { describe, expect, it } from 'vitest';
import {
  supportsReasoningEffortProtocol,
  usesLegacyReasoningEffort,
} from './reasoning-effort-protocol';

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

describe('usesLegacyReasoningEffort', () => {
  it.each([
    ['5.1', true],
    ['4.9', true],
    ['5.2', false],
    ['16.0', false],
    // Malformed or missing metadata never downgrades a modern daemon.
    ['16', false],
    ['16.0-dev', false],
    [undefined, false],
    [null, false],
  ])('%s → %s', (version, expected) => {
    expect(usesLegacyReasoningEffort(version)).toBe(expected);
  });
});
