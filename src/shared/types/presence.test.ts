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

describe('discussion typing roster compatibility', () => {
  it('accepts omitted/empty rosters and source/pulse entries without agent targets', () => {
    expect(isPresenceRoster(roster(row))).toBe(true);
    expect(isPresenceRoster(roster({ ...row, discussionTyping: [] }))).toBe(true);
    expect(
      isPresenceRoster(
        roster({
          ...row,
          discussionTyping: [{ source: 'source', since: '2099-01-01T00:00:00Z', pulse: 1 }],
        }),
      ),
    ).toBe(true);
  });
  it.each([
    null,
    {},
    [{ source: '', since: 'now', pulse: 1 }],
    [{ source: 's', since: 'now', pulse: -1 }],
    [{ source: 's', since: 'now', pulse: 1.5 }],
    [{ source: 's', pulse: 1 }],
  ])('rejects malformed discussion typing %j', (discussionTyping) => {
    expect(isPresenceRoster(roster({ ...row, discussionTyping }))).toBe(false);
  });
});
