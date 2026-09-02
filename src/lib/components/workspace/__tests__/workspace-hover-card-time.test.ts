import { describe, expect, it } from 'vitest';
import { formatWorkspaceHoverCardTimestamp } from '../workspace-hover-card-time';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);

describe('formatWorkspaceHoverCardTimestamp', () => {
  it.each([
    [59_999, '<1m'],
    [60_000, '1m'],
    [59 * 60_000 + 59_999, '59m'],
    [60 * 60_000, '1h'],
    [23 * 60 * 60_000 + 59 * 60_000, '23h'],
    [24 * 60 * 60_000, '1d'],
    [29 * 24 * 60 * 60_000 + 23 * 60 * 60_000, '29d'],
    [30 * 24 * 60 * 60_000, '1mo'],
    [90 * 24 * 60 * 60_000, '3mo'],
  ])('formats the %i ms boundary as %s', (age, expected) => {
    expect(formatWorkspaceHoverCardTimestamp(ago(age), NOW)?.compact).toBe(expected);
  });

  it('returns machine-readable and accessible time metadata', () => {
    const result = formatWorkspaceHoverCardTimestamp(ago(4 * 60_000), NOW);
    expect(result).toMatchObject({ compact: '4m', dateTime: '2026-08-31T11:56:00.000Z' });
    expect(result?.accessible).toContain('4 minutes');
  });

  it('rejects missing and invalid timestamps', () => {
    expect(formatWorkspaceHoverCardTimestamp(undefined, NOW)).toBeNull();
    expect(formatWorkspaceHoverCardTimestamp('invalid', NOW)).toBeNull();
  });
});
