/**
 * Unit tests for the protocol-compatibility comparison (T15).
 *
 * Only the MAJOR protocolVersion segment is significant: a minor bump is
 * backward-compatible, a major difference is warn-but-allow, and any
 * unparsable/absent version yields `unknown` (no warning surfaced).
 */

import { describe, it, expect } from 'vitest';
import { protocolMajor, compareProtocolMajor, protocolVersionAtLeast } from './protocol-compat';

describe('protocolMajor', () => {
  it('extracts the leading integer segment', () => {
    expect(protocolMajor('1')).toBe(1);
    expect(protocolMajor('2.2')).toBe(2);
    expect(protocolMajor('10.4.1')).toBe(10);
    expect(protocolMajor(' 3.0 ')).toBe(3);
  });

  it('returns null for absent or non-numeric majors', () => {
    expect(protocolMajor(null)).toBeNull();
    expect(protocolMajor(undefined)).toBeNull();
    expect(protocolMajor('')).toBeNull();
    expect(protocolMajor('v2')).toBeNull();
    expect(protocolMajor('beta')).toBeNull();
  });
});

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

describe('protocolVersionAtLeast', () => {
  it('compares major.minor numerically, not lexically', () => {
    expect(protocolVersionAtLeast('10.4', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('10.10', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('10.4.1', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast(' 10.5 ', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('10.3', 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('10', 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('10.0', 10, 0)).toBe(true);
  });

  it('passes any greater major regardless of minor', () => {
    expect(protocolVersionAtLeast('11.0', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('11', 10, 4)).toBe(true);
    expect(protocolVersionAtLeast('9.99', 10, 4)).toBe(false);
  });

  it('is false for absent or unparsable versions', () => {
    expect(protocolVersionAtLeast(null, 10, 4)).toBe(false);
    expect(protocolVersionAtLeast(undefined, 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('', 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('v10.4', 10, 4)).toBe(false);
    expect(protocolVersionAtLeast('10.x', 10, 4)).toBe(false);
  });
});
