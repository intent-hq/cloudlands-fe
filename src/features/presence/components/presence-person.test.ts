import { describe, expect, it } from 'vitest';
import {
  presencePersonForgeHandle,
  presencePersonLabel,
  presencePersonNameWithForge,
  presencePersonRing,
  type PresenceCircle,
} from './presence-person';

const circle = (facts: Partial<PresenceCircle>): PresenceCircle => ({
  principalId: 'p-1',
  login: 'p-1',
  displayName: null,
  avatarUrl: null,
  ...facts,
});

const github = { provider: 'github', host: 'github.com', externalUserId: '42' } as const;
const gitlab = { provider: 'gitlab', host: 'gitlab.example.com', externalUserId: '7' } as const;

describe('forge handle', () => {
  it('names the login on its forge — GitHub by name, GitLab by instance — and nothing without an identity', () => {
    expect(presencePersonForgeHandle(circle({ login: 'ada', identity: github }))).toBe(
      '@ada on GitHub',
    );
    expect(presencePersonForgeHandle(circle({ login: 'ada', identity: gitlab }))).toBe(
      '@ada on gitlab.example.com',
    );
    expect(presencePersonForgeHandle(circle({ login: 'ada' }))).toBeNull();
  });

  it('falls back to the bare forge for an identity without a resolved login', () => {
    expect(presencePersonForgeHandle(circle({ login: null, identity: github }))).toBe('GitHub');
    expect(presencePersonForgeHandle(circle({ login: null, identity: gitlab }))).toBe(
      'GitLab (gitlab.example.com)',
    );
  });

  it('uses the forge handle without repeating the fallback login, preserving the self marker', () => {
    expect(presencePersonNameWithForge(circle({ login: 'ada', identity: gitlab }))).toBe(
      '@ada on gitlab.example.com',
    );
    expect(presencePersonNameWithForge(circle({ login: 'ada' }))).toBe('ada');
    expect(presencePersonLabel(circle({ login: 'ada', self: true, identity: github }))).toBe(
      '@ada on GitHub (you)',
    );
    expect(presencePersonLabel(circle({ login: 'ada', self: true }))).toBe('ada (you)');
  });

  describe.each([
    { identity: github, handle: '@ada on GitHub', forge: 'GitHub' },
    {
      identity: gitlab,
      handle: '@ada on gitlab.example.com',
      forge: 'GitLab (gitlab.example.com)',
    },
  ])('$identity.provider display names', ({ identity, handle, forge }) => {
    it.each([undefined, null, '', '  ', 'ada', ' ada ', 'Ada', '@ada'])(
      'omits the missing or handle-derived display name %j',
      (displayName) => {
        const person = circle({ login: 'ada', displayName, identity });
        expect(presencePersonNameWithForge(person)).toBe(handle);
        expect(presencePersonLabel(person)).toBe(handle);
      },
    );

    it('keeps a distinct custom display name with the forge and self marker', () => {
      const person = circle({ login: 'ada', displayName: ' Ada Lovelace ', identity, self: true });
      expect(presencePersonNameWithForge(person)).toBe(`Ada Lovelace · ${handle}`);
      expect(presencePersonLabel(person)).toBe(`Ada Lovelace · ${handle} (you)`);
    });

    it.each([null, '', '  '])('keeps the forge when the login is %j', (login) => {
      expect(presencePersonNameWithForge(circle({ login, identity }))).toBe(forge);
      expect(
        presencePersonNameWithForge(circle({ login, displayName: 'Ada Lovelace', identity })),
      ).toBe(`Ada Lovelace · ${forge}`);
    });
  });
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
