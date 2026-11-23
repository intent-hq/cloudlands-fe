/**
 * @vitest-environment jsdom
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
import type { GoalSetBy } from '$shared/types/agent-session';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  presenceContextReceived,
  presenceMembersReceived,
  presenceOwnPrincipalReceived,
  presenceWorkspacesReceived,
} from '$store/renderer/slices/presence/presence-slice';
import { selectPresenceContext } from '$store/renderer/slices/presence/presence-selectors';
import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import GoalStrip from '../GoalStrip.svelte';
import GoalNotice from '../GoalNotice.svelte';

const createdAt = '2026-11-22T08:00:00Z';
const ME = 'p-me';

const member = (principalId: string, displayName: string | null, login: string | null) =>
  ({
    principalId,
    displayName,
    login,
    avatarUrl: null,
    role: 'collaborator',
    addedAt: createdAt,
  }) as WorkspaceMember;

const alice = member('p-alice', 'Alice', 'alice');
const me = member(ME, 'Me Myself', 'me');

let counter = 0;

/** A fresh workspace + agent with the given goal, attribution and roster. */
function seed({
  memberCount,
  goalSetBy,
  members,
}: {
  memberCount?: number;
  goalSetBy?: GoalSetBy;
  members?: WorkspaceMember[];
}): { workspaceId: string; agentId: string } {
  counter += 1;
  const workspaceId = `ws-goal-attr-${counter}`;
  const agentId = `agent-goal-attr-${counter}`;
  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Goal attribution',
      branch: 'main',
      path: '/tmp/goal',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt,
      updatedAt: createdAt,
      ...(memberCount !== undefined ? { memberCount } : {}),
    }),
  );
  store.dispatch(presenceWorkspacesReceived([...store.state.presence.workspaceIds, workspaceId]));
  if (members) store.dispatch(presenceMembersReceived(workspaceId, members));
  store.dispatch(
    bulkUpsertSessions(
      [
        {
          id: AgentId(agentId),
          backendSessionId: null,
          workspaceId: WorkspaceId(workspaceId),
          name: 'Developer',
          status: AgentStatus.Idle,
          messages: [],
          createdAt,
          updatedAt: createdAt,
          goal: 'Ship the attribution',
          ...(goalSetBy ? { goalSetBy } : {}),
        } as unknown as AgentSession,
      ],
      { preserveExplicitRuntimeFlags: true },
    ),
  );
  return { workspaceId, agentId };
}

function stripAttribution(ids: { workspaceId: string; agentId: string }): string | null {
  render(GoalStrip, { props: ids });
  expect(screen.getByTestId('goal-strip')).toBeTruthy();
  return screen.queryByTestId('goal-strip-attribution')?.textContent ?? null;
}

let dispose: (() => void) | undefined;

beforeAll(() => {
  dispose = store.init();
  admitLegacyPrincipal('owner', { conversationGoal: 1 });
  store.dispatch(presenceContextReceived(selectPresenceContext.select(store.state)!, ME));
});

afterEach(() => cleanup());
afterAll(() => dispose?.());

describe('goal strip attribution', () => {
  it('is hidden in a personal workspace even when goalSetBy is served', () => {
    expect(
      stripAttribution(
        seed({
          memberCount: 1,
          goalSetBy: { principalId: 'p-alice', displayName: 'Alice', login: 'alice' },
          members: [alice],
        }),
      ),
    ).toBeNull();
    expect(
      stripAttribution(
        seed({ goalSetBy: { principalId: 'p-alice', displayName: 'Alice', login: 'alice' } }),
      ),
    ).toBeNull();
  });

  it('reads the viewer as "you" in a shared workspace', () => {
    expect(
      stripAttribution(
        seed({
          memberCount: 2,
          goalSetBy: { principalId: ME, displayName: 'Me Myself', login: 'me' },
          members: [me, alice],
        }),
      ),
    ).toBe(m.chat_goalStrip_setByYou_label());
  });

  it('names another member from the current roster, not the write-time snapshot', () => {
    expect(
      stripAttribution(
        seed({
          memberCount: 2,
          goalSetBy: { principalId: 'p-alice', displayName: 'Alice (old)', login: 'alice' },
          members: [me, alice],
        }),
      ),
    ).toBe(m.chat_goalStrip_setBy_label({ name: 'Alice' }));
  });

  it('falls back to the snapshot, then "a former member", for someone who left', () => {
    expect(
      stripAttribution(
        seed({
          memberCount: 2,
          goalSetBy: { principalId: 'p-dan', displayName: null, login: 'dan' },
          members: [me, alice],
        }),
      ),
    ).toBe(m.chat_goalStrip_setBy_label({ name: 'dan' }));
    cleanup();
    expect(
      stripAttribution(
        seed({
          memberCount: 2,
          goalSetBy: { principalId: 'p-dan', displayName: null, login: null },
          members: [me, alice],
        }),
      ),
    ).toBe(m.chat_goalStrip_setByFormerMember_label());
  });

  it('fails closed while the viewer principal is unknown', () => {
    const ids = seed({
      memberCount: 2,
      goalSetBy: { principalId: ME, displayName: 'Me Myself', login: 'me' },
      members: [me, alice],
    });
    store.dispatch(presenceOwnPrincipalReceived(null));
    try {
      // Never the viewer's own name in place of "you".
      expect(stripAttribution(ids)).toBeNull();
    } finally {
      store.dispatch(presenceOwnPrincipalReceived(ME));
    }
  });

  it('shows nothing for an unattributed goal in a shared workspace', () => {
    expect(stripAttribution(seed({ memberCount: 3, members: [me, alice] }))).toBeNull();
  });
});

describe('goal notice attribution', () => {
  function noticeAttribution(
    ids: { workspaceId: string; agentId: string },
    fromPrincipalId?: string,
  ): string | null {
    render(GoalNotice, {
      props: {
        notice: {
          action: 'set',
          goal: 'Ship the attribution',
          ...(fromPrincipalId ? { fromPrincipalId } : {}),
        },
        ...ids,
      },
    });
    return screen.queryByTestId('goal-notice-attribution')?.textContent ?? null;
  }

  it('attributes rows from metadata.fromPrincipalId in a shared workspace', () => {
    const shared = seed({ memberCount: 2, members: [me, alice] });
    expect(noticeAttribution(shared, 'p-alice')).toBe(
      m.chat_goalNotice_by_label({ name: 'Alice' }),
    );
    cleanup();
    expect(noticeAttribution(shared, ME)).toBe(m.chat_goalNotice_byYou_label());
    cleanup();
    expect(noticeAttribution(shared, 'p-gone')).toBe(m.chat_goalNotice_byFormerMember_label());
    cleanup();
    expect(screen.queryByTestId('goal-notice-attribution')).toBeNull();
    expect(noticeAttribution(shared)).toBeNull();
  });

  it('is hidden in a personal workspace', () => {
    expect(noticeAttribution(seed({ memberCount: 1, members: [alice] }), 'p-alice')).toBeNull();
  });

  it('does not borrow the current goal writer for an unattributed row', () => {
    const shared = seed({
      memberCount: 2,
      goalSetBy: { principalId: 'p-alice', displayName: 'Alice', login: 'alice' },
      members: [me, alice],
    });
    expect(noticeAttribution(shared)).toBeNull();
  });
});
