import { describe, expect, it } from 'vitest';
import {
  getChiefThreadTitle,
  isPlaceholderChiefThreadName,
} from '$store/renderer/slices/sidebar-nav/chief-thread-title';
import { formatChiefThreadName } from './chief-thread-name';

describe('formatChiefThreadName', () => {
  it('creates a placeholder eligible for automatic renaming', () => {
    const name = formatChiefThreadName(new Date('2026-05-01T12:00:00.000Z'));
    expect(isPlaceholderChiefThreadName(name)).toBe(true);
  });

  it.each([
    'New chat with Assistant',
    'New chat with Intent',
    'Chief of Staff',
    'New thread May 1st',
  ])('keeps legacy placeholder %s eligible for renaming', (name) => {
    expect(isPlaceholderChiefThreadName(name)).toBe(true);
    expect(getChiefThreadTitle({ name, messages: [] })).toBe('New chat');
  });

  it('preserves custom thread titles', () => {
    const name = 'Review my release plan';
    expect(isPlaceholderChiefThreadName(name)).toBe(false);
    expect(getChiefThreadTitle({ name, messages: [] })).toBe(name);
  });
});
