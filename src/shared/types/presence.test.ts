import { describe, expect, it } from 'vitest';
import { effectivePresenceRows, isPresenceRoster } from './presence';
const row = {
  principalId: 'p',
  login: null,
  displayName: null,
  avatarUrl: null,
  focus: [],
  typing: [],
};
const roster = (member: object) => ({ workspaceId: 'ws', members: [member] });
describe('presence identity boundary', () => {
  it('preserves additive authoritative role and provider-qualified identity', () => {
    expect(
      isPresenceRoster(
        roster({
          ...row,
          hostRole: 'member',
          identity: { provider: 'gitlab', host: 'gitlab.example.com', externalUserId: '7' },
        }),
      ),
    ).toBe(true);
    expect(isPresenceRoster(roster(row))).toBe(true);
  });
  it.each([
    { hostRole: 'admin' },
    { hostRole: null },
    { hostRole: {} },
    { principalId: '' },
    { identity: null },
    { identity: { provider: 'github', host: 'github.com', externalUserId: 7 } },
    { identity: { provider: 'other', host: 'github.com', externalUserId: '7' } },
    { identity: { provider: 'gitlab', host: '', externalUserId: '7' } },
    { identity: { provider: 'gitlab', host: 'gitlab.example.com', externalUserId: '' } },
  ])('rejects malformed authority/identity %j', (fields) =>
    expect(isPresenceRoster(roster({ ...row, ...fields }))).toBe(false),
  );
  it('deduplicates by trusted principal, never matching handles or devices, with host membership superseding a retained grant', () => {
    const people = effectivePresenceRows([
      { ...row, hostRole: 'member' as const, login: 'same' },
      { ...row, hostRole: 'guest' as const, login: 'same' },
      { ...row, principalId: 'different', hostRole: 'guest' as const, login: 'same' },
    ]);
    expect(people.map((p) => [p.principalId, p.hostRole])).toEqual([
      ['p', 'member'],
      ['different', 'guest'],
    ]);
  });
});
