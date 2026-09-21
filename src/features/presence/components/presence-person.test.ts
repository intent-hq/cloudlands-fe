import { describe, expect, it } from 'vitest';
import {
  presencePersonForgeHandle,
  presencePersonLabel,
  presencePersonNameWithForge,
  presencePersonRing,
  type PresenceCircle,
} from './presence-person';

const circle = (
  facts: Partial<Pick<PresenceCircle, 'owner' | 'online' | 'self' | 'login' | 'identity'>>,
): PresenceCircle => ({
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

  it('appends the handle to the name, after the "(you)" mark, only when the row carries an identity', () => {
    expect(presencePersonNameWithForge(circle({ login: 'ada', identity: gitlab }))).toBe(
      'ada · @ada on gitlab.example.com',
    );
    expect(presencePersonNameWithForge(circle({ login: 'ada' }))).toBe('ada');
    expect(presencePersonLabel(circle({ login: 'ada', self: true, identity: github }))).toBe(
      'ada (you) · @ada on GitHub',
    );
    expect(presencePersonLabel(circle({ login: 'ada', self: true }))).toBe('ada (you)');
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
