import { describe, expect, it } from 'vitest';
import { formatChiefThreadName } from './chief-thread-name';

describe('formatChiefThreadName', () => {
  it('uses the neutral Intent title for new blank threads', () => {
    expect(formatChiefThreadName(new Date('2026-05-01T12:00:00.000Z'))).toBe(
      'New chat with Intent',
    );
  });
});
