/**
 * Unit tests for the warn-only protocol major comparison (T15). Parsing and
 * minimum-version gates are tested with src/shared/protocol-version.ts.
 *
 * Only the MAJOR protocolVersion segment is significant: a minor bump is
 * backward-compatible, a major difference is warn-but-allow, and any
 * unparsable/absent version yields `unknown` (no warning surfaced).
 */

import { describe, it, expect } from 'vitest';
import { compareProtocolMajor } from './protocol-compat';

describe('compareProtocolMajor', () => {
  it('matches when the majors are equal (ignoring minor/patch)', () => {
    expect(compareProtocolMajor('1', '1')).toBe('match');
    expect(compareProtocolMajor('2.0', '2.9')).toBe('match');
    expect(compareProtocolMajor('1.2', '1.5.3')).toBe('match');
  });

  it('reports a mismatch when the majors differ', () => {
    expect(compareProtocolMajor('1', '2')).toBe('mismatch');
    expect(compareProtocolMajor('2.2', '1')).toBe('mismatch');
    expect(compareProtocolMajor('1.9', '10.0')).toBe('mismatch');
  });

  it('is unknown when either side is missing or unparsable', () => {
    expect(compareProtocolMajor(null, '1')).toBe('unknown');
    expect(compareProtocolMajor('1', undefined)).toBe('unknown');
    expect(compareProtocolMajor('1', 'vNext')).toBe('unknown');
    expect(compareProtocolMajor('', '2')).toBe('unknown');
  });
});
