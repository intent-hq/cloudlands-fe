import {
  describe,
  it,
  expect,
} from 'vitest';
import { SessionStatsGetSchema } from '../../../main/ipc-schemas';

describe('SessionStatsGetSchema', () => {
  it('accepts valid session IDs (UUIDs, slugs, alphanumeric)', () => {
    const result = SessionStatsGetSchema.safeParse({
      sessionIds: [
        'abc-123',
        '550e8400-e29b-41d4-a716-446655440000',
        'sess_01HXXXXXXXXXXXXXXXXXXXXXXX',
        'ABC-def_123',
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects session IDs containing shell metacharacters', () => {
    const bad = ['foo & calc', 'foo|bar', 'foo;bar', 'foo`bar', 'foo$bar', 'foo"bar'];
    for (const id of bad) {
      const result = SessionStatsGetSchema.safeParse({ sessionIds: [id] });
      expect(result.success, `expected rejection for ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it('rejects empty session ID strings', () => {
    const result = SessionStatsGetSchema.safeParse({ sessionIds: [''] });
    expect(result.success).toBe(false);
  });

  it('rejects empty sessionIds array', () => {
    const result = SessionStatsGetSchema.safeParse({ sessionIds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects session IDs longer than 128 chars', () => {
    const tooLong = 'a'.repeat(129);
    const result = SessionStatsGetSchema.safeParse({ sessionIds: [tooLong] });
    expect(result.success).toBe(false);
  });

  it('rejects flag-like session IDs that start with a hyphen', () => {
    const flagLike = ['--help', '-x', '-abc'];
    for (const id of flagLike) {
      const result = SessionStatsGetSchema.safeParse({ sessionIds: [id] });
      expect(result.success, `expected rejection for ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it('accepts session IDs that contain hyphens but do not start with one', () => {
    const valid = ['abc-def', '_abc', 'A1B2', '01ABC-XYZ-123'];
    const result = SessionStatsGetSchema.safeParse({ sessionIds: valid });
    expect(result.success).toBe(true);
  });
});
