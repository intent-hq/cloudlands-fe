import { describe, expect, it } from 'vitest';
import type { WorkspaceInvite } from '../types';
import { findCopyableInvite, type InviteAudience } from './invite-audience';

const now = Date.parse('2026-10-15T12:00:00Z');
const audience: InviteAudience = {
  workspaceId: 'ws',
  login: 'alex',
  provider: 'github',
  host: 'github.com',
  externalUserId: '42',
};
const invite: WorkspaceInvite = {
  id: 'invite',
  workspaceId: 'ws',
  createdByPrincipalId: 'owner',
  pinLogin: 'Alex',
  pinGithubUserId: 42,
  createdAt: '2026-10-15T00:00:00Z',
  expiresAt: '2026-10-16T00:00:00Z',
};
const links = { invite: 'intent://invite?token=fixture' };

describe('copyable invite audience', () => {
  it('matches a legacy GitHub pin case-insensitively and checks its account id', () => {
    expect(findCopyableInvite([invite], links, audience, now)).toBe(invite);
    expect(
      findCopyableInvite([invite], links, { ...audience, externalUserId: '99' }, now),
    ).toBeUndefined();
  });
  it.each([
    { workspaceId: 'other' },
    { pinLogin: 'someone-else' },
    { expiresAt: '2026-10-15T12:00:00Z' },
    { expiresAt: 'invalid' },
    { revokedAt: '2026-10-15T01:00:00Z' },
    { redeemedAt: '2026-10-15T01:00:00Z' },
    { pinIdentity: { provider: 'gitlab' as const, host: 'gitlab.com', externalUserId: '42' } },
  ])('rejects a different audience or unavailable invite: %j', (patch) => {
    expect(findCopyableInvite([{ ...invite, ...patch }], links, audience, now)).toBeUndefined();
  });
  it('requires a vault URL and a matching GitLab instance', () => {
    expect(findCopyableInvite([invite], {}, audience, now)).toBeUndefined();
    const gitlab = {
      ...invite,
      pinIdentity: { provider: 'gitlab' as const, host: 'forge.example', externalUserId: '42' },
    };
    expect(
      findCopyableInvite(
        [gitlab],
        links,
        { ...audience, provider: 'gitlab', host: 'forge.example' },
        now,
      ),
    ).toBe(gitlab);
    expect(
      findCopyableInvite(
        [gitlab],
        links,
        { ...audience, provider: 'gitlab', host: 'other.example' },
        now,
      ),
    ).toBeUndefined();
  });
  it('reuses an unpinned reusable link after redemption, never a restricted one', () => {
    const open = {
      ...invite,
      pinLogin: undefined,
      pinGithubUserId: undefined,
      reusable: true,
      redeemedAt: '2026-10-15T01:00:00Z',
    };
    expect(findCopyableInvite([invite, open], links, { ...audience, login: '' }, now)).toBe(open);
    expect(findCopyableInvite([invite], links, { ...audience, login: '' }, now)).toBeUndefined();
  });
});
