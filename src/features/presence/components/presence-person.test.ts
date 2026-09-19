import { describe, expect, it } from 'vitest';
import { presencePersonRing, type PresenceCircle } from './presence-person';

const circle = (facts: Partial<Pick<PresenceCircle, 'owner' | 'online'>>): PresenceCircle => ({
  principalId: 'p-1',
  login: 'p-1',
  displayName: null,
  avatarUrl: null,
  ...facts,
});

describe('presencePersonRing', () => {
  it('keeps the owner ring on the owner whether online or offline', () => {
    expect(presencePersonRing(circle({ owner: true, online: true }))).toBe('owner');
    expect(presencePersonRing(circle({ owner: true, online: false }))).toBe('owner');
    expect(presencePersonRing(circle({ owner: true }))).toBe('owner');
  });

  it('rings a non-owner by whether they are online, none when unknown', () => {
    expect(presencePersonRing(circle({ owner: false, online: true }))).toBe('member');
    expect(presencePersonRing(circle({ owner: false, online: false }))).toBe('offline');
    expect(presencePersonRing(circle({}))).toBeNull();
  });
});
