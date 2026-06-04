import { describe, expect, it } from 'vitest';
import { formatChiefThreadName } from './chief-thread-name';

describe('formatChiefThreadName', () => {
  it.each([
    ['2026-05-01T12:00:00.000Z', 'New thread May 1st'],
    ['2026-05-02T12:00:00.000Z', 'New thread May 2nd'],
    ['2026-05-03T12:00:00.000Z', 'New thread May 3rd'],
    ['2026-05-04T12:00:00.000Z', 'New thread May 4th'],
    ['2026-05-11T12:00:00.000Z', 'New thread May 11th'],
    ['2026-05-12T12:00:00.000Z', 'New thread May 12th'],
    ['2026-05-13T12:00:00.000Z', 'New thread May 13th'],
    ['2026-07-21T12:00:00.000Z', 'New thread July 21st'],
    ['2026-07-22T12:00:00.000Z', 'New thread July 22nd'],
    ['2026-08-23T12:00:00.000Z', 'New thread August 23rd'],
  ])('formats %s as %s', (isoDate, expected) => {
    expect(formatChiefThreadName(new Date(isoDate))).toBe(expected);
  });
});
