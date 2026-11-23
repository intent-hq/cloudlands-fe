import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import {
  goalNoticeAttributionLabel,
  goalStripAttributionLabel,
  resolveGoalAttribution,
  sameGoalAttribution,
} from './goal-attribution';

const alice = { principalId: 'p-alice', displayName: 'Alice Doe', login: 'alice' };
const bob = { principalId: 'p-bob', displayName: null, login: 'bob' };

describe('resolveGoalAttribution', () => {
  it('reads the viewer as "you"', () => {
    expect(
      resolveGoalAttribution({
        principalId: 'p-me',
        snapshot: { principalId: 'p-me', displayName: 'Me', login: 'me' },
        members: [],
        ownPrincipalId: 'p-me',
      }),
    ).toEqual({ kind: 'self' });
  });

  it('prefers the current member entry over the write-time snapshot', () => {
    expect(
      resolveGoalAttribution({
        principalId: 'p-alice',
        snapshot: { principalId: 'p-alice', displayName: 'Old Name', login: 'alice' },
        members: [alice],
        ownPrincipalId: 'p-me',
      }),
    ).toEqual({ kind: 'member', name: 'Alice Doe' });
  });

  it('falls back from displayName to login', () => {
    expect(
      resolveGoalAttribution({ principalId: 'p-bob', members: [bob], ownPrincipalId: 'p-me' }),
    ).toEqual({ kind: 'member', name: 'bob' });
  });

  it('uses the snapshot when the roster is unknown or the member has no name', () => {
    const snapshot = { principalId: 'p-carol', displayName: '  Carol\n  C. ', login: null };
    expect(
      resolveGoalAttribution({
        principalId: 'p-carol',
        snapshot,
        members: null,
        ownPrincipalId: null,
      }),
    ).toEqual({ kind: 'member', name: 'Carol C.' });
    expect(
      resolveGoalAttribution({
        principalId: 'p-carol',
        snapshot,
        members: [{ principalId: 'p-carol', displayName: null, login: null }],
        ownPrincipalId: null,
      }),
    ).toEqual({ kind: 'member', name: 'Carol C.' });
  });

  it('uses the snapshot of a writer who left the workspace', () => {
    expect(
      resolveGoalAttribution({
        principalId: 'p-dan',
        snapshot: { principalId: 'p-dan', displayName: 'Dan', login: 'dan' },
        members: [alice],
        ownPrincipalId: 'p-me',
      }),
    ).toEqual({ kind: 'member', name: 'Dan' });
  });

  it('says "a former member" only when a known roster no longer has the writer', () => {
    expect(
      resolveGoalAttribution({ principalId: 'p-dan', members: [alice], ownPrincipalId: 'p-me' }),
    ).toEqual({ kind: 'former' });
    expect(
      resolveGoalAttribution({ principalId: 'p-dan', members: null, ownPrincipalId: 'p-me' }),
    ).toBeNull();
  });

  it('ignores a snapshot that names another principal', () => {
    expect(
      resolveGoalAttribution({
        principalId: 'p-dan',
        snapshot: { principalId: 'p-alice', displayName: 'Alice', login: 'alice' },
        members: null,
        ownPrincipalId: null,
      }),
    ).toBeNull();
  });

  it('shows nothing for an unattributed goal', () => {
    expect(
      resolveGoalAttribution({ principalId: undefined, members: [alice], ownPrincipalId: 'p-me' }),
    ).toBeNull();
    expect(
      resolveGoalAttribution({ principalId: '  ', members: [alice], ownPrincipalId: 'p-me' }),
    ).toBeNull();
  });
});

describe('attribution labels', () => {
  it('renders strip and notice text for each kind', () => {
    expect(goalStripAttributionLabel({ kind: 'self' })).toBe(m.chat_goalStrip_setByYou_label());
    expect(goalStripAttributionLabel({ kind: 'member', name: 'Alice' })).toBe(
      m.chat_goalStrip_setBy_label({ name: 'Alice' }),
    );
    expect(goalStripAttributionLabel({ kind: 'former' })).toBe(
      m.chat_goalStrip_setByFormerMember_label(),
    );
    expect(goalNoticeAttributionLabel({ kind: 'self' })).toBe(m.chat_goalNotice_byYou_label());
    expect(goalNoticeAttributionLabel({ kind: 'member', name: 'Alice' })).toBe(
      m.chat_goalNotice_by_label({ name: 'Alice' }),
    );
    expect(goalNoticeAttributionLabel({ kind: 'former' })).toBe(
      m.chat_goalNotice_byFormerMember_label(),
    );
  });

  it('compares attributions by value', () => {
    expect(sameGoalAttribution({ kind: 'member', name: 'A' }, { kind: 'member', name: 'A' })).toBe(
      true,
    );
    expect(sameGoalAttribution({ kind: 'member', name: 'A' }, { kind: 'member', name: 'B' })).toBe(
      false,
    );
    expect(sameGoalAttribution({ kind: 'self' }, { kind: 'former' })).toBe(false);
    expect(sameGoalAttribution(null, null)).toBe(true);
  });
});
