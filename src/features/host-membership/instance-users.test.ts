import { expect, it } from 'vitest';
import { instanceUserRows } from './instance-users';
import type { HostInvite, HostMember } from './types';
const github = { provider: 'github' as const, host: 'github.com', externalUserId: '1' };
const gitlab = { provider: 'gitlab' as const, host: 'gitlab.example', externalUserId: '1' };
const member: HostMember = {
  principalId: 'github-person',
  hostRole: 'member',
  login: 'sam',
  displayName: null,
  avatarUrl: null,
  identity: github,
  addedAt: '2026-10-03T00:00:00Z',
};
const invite: HostInvite = {
  id: 'github-person',
  scope: 'host',
  role: 'member',
  createdByPrincipalId: 'owner',
  pinLogin: 'sam',
  pinIdentity: github,
  reusable: false,
  redemptionCount: 0,
  createdAt: '2026-10-03T00:00:00Z',
  expiresAt: '2026-10-10T00:00:00Z',
};
it('keeps same-login forges, invite IDs and principal IDs distinct without cosmetic deduplication', () => {
  const other = { ...member, principalId: 'gitlab-person', identity: gitlab };
  const rows = instanceUserRows([member, other], [invite], ['github-person']);
  expect(rows).toEqual([
    { kind: 'member', key: 'member:github-person', member, online: true },
    { kind: 'member', key: 'member:gitlab-person', member: other, online: false },
    { kind: 'invite', key: 'invite:github-person', invite },
  ]);
});
it('distinguishes unknown status from an observed empty roster and replaces invitations after admission', () => {
  expect(instanceUserRows([member], [invite], null)[0]).toMatchObject({ online: undefined });
  expect(instanceUserRows([member], [], [])).toEqual([
    { kind: 'member', key: 'member:github-person', member, online: false },
  ]);
  expect(instanceUserRows([], [], ['github-person'])).toEqual([]);
});
