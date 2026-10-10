import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
/**
 * @vitest-environment jsdom
 *
 * The workspace sidebar's presence row: the production people selectors run
 * over real presence + workspace state, and each avatar takes the viewer to
 * where that person looks (agent chat, else note), with no Share fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { PresenceFocusItem, PresenceMember } from '$shared/types/presence';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import {
  initialState as presenceInitialState,
  presenceMembersReceived,
  presenceOwnPrincipalReceived,
  presenceReducer,
  presenceRosterReceived,
} from '$store/renderer/slices/presence/presence-slice';
import type { PresenceState } from '$store/renderer/slices/presence/presence-types';
import { openShareDialog } from '$store/renderer/slices/workspace-share/workspace-share-slice';
import { selectPresenceFollowScope } from '$store/renderer/slices/presence-follow/presence-follow-selectors';
import {
  presenceFollowReducer,
  presenceFollowScopeChanged,
  presenceFollowFrameReceived,
  followPresencePersonRequested,
} from '$store/renderer/slices/presence-follow/presence-follow-slice';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const navigateToNote = vi.fn(() => Promise.resolve());
  const notes = [] as Note[];
  const agents = [] as Array<{ id: string; name: string; isStreaming: boolean }>;
  const workspaceEntity = {
    id: 'ws-1',
    title: 'Shared Workspace',
    branch: 'feature/presence',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    repositoryOwner: 'augment',
    repositoryName: 'intent',
  } as Workspace;
  const state = {
    panelLayout: { byWorkspaceId: { 'ws-1': { columnCount: 1, panels: {} } } },
    workspace: { workspaces: null as unknown, pendingTitleMutations: {} },
    presence: null as unknown,
    presenceFollow: null as unknown,
    tabState: { currentTabId: 'ws-1' },
    userPreferences: undefined as { labsMultiplayerEnabled?: boolean } | undefined,
  };
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) =>
    Object.assign(() => readable(getter()), { select: getter });
  return {
    dispatch,
    navigateToNote,
    notes,
    agents,
    workspaceEntity,
    state,
    selector,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
});

vi.mock('$lib/utils/workspace-navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/workspace-navigation')>()),
  navigateToNote: mocks.navigateToNote,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectCanSetWorkspacePrimaryClient: mocks.selector(() => true),
  selectCanShareWorkspace: mocks.selector(
    () =>
      mocks.state.userPreferences?.labsMultiplayerEnabled === true &&
      mocks.workspaceEntity.myRole === 'owner',
  ),
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => []),
  selectHidesOwnerWorkspaceActions: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
  selectSpecTaskLinks: mocks.selector(() => null),
}));
vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksInitialized: mocks.selector(() => true),
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0, inProgress: 0 })),
}));
vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-selectors', () => ({
  selectUnreadNoteIds: mocks.selector(() => []),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => mocks.agents),
}));
vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectAcceptChangesStatus: mocks.selector(() => null),
  selectAcceptChangesStatusLoading: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectSidebarSide: mocks.selector(() => 'left'),
}));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: vi.fn(), archive: vi.fn(), unarchive: vi.fn() },
}));
vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { getStatus: vi.fn().mockResolvedValue({}) },
}));
vi.mock('$lib/electron-bridge', () => ({ listenSync: vi.fn(() => () => {}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('../../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('./mocks/MockTooltipRich.svelte')).default,
}));
vi.mock('$lib/components/icons/SidebarIcon.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/modals/DeleteWarningDialog.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/HoverCard.svelte', async () => ({
  default: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/workspace/TaskStatusIndicator.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/tiptap/TaskAgentStatus.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('../FlameGraph.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/Fa.svelte')).default,
}));

const rosterMember = (principalId: string, focus: PresenceMember['focus']): PresenceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  focus,
  typing: [],
});
const accepted = (principalId: string, role: WorkspaceMember['role']): WorkspaceMember => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  role,
  addedAt: '2026-09-14T12:00:00Z',
});
const presenceState = (...actions: Parameters<typeof presenceReducer>[1][]): PresenceState =>
  actions.reduce((state, action) => presenceReducer(state, action), {
    ...presenceInitialState,
    context: 'fixture',
    workspaceIds: ['ws-1'],
  });
const membership = presenceMembersReceived('ws-1', [
  accepted('me', 'owner'),
  accepted('ada', 'collaborator'),
  accepted('bob', 'collaborator'),
  accepted('cy', 'collaborator'),
]);
// ada reads an agent chat, bob a note, cy only has the workspace tab open.
const roster = presenceRosterReceived({
  workspaceId: 'ws-1',
  members: [
    rosterMember('me', [{ workspaceId: 'ws-1', agentId: 'agent-1' }]),
    rosterMember('ada', [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-1', agentId: 'agent-1' }]),
    rosterMember('bob', [{ workspaceId: 'ws-1', noteId: 'note-1' }]),
    rosterMember('cy', [{ workspaceId: 'ws-1' }]),
  ],
});

async function renderProgressCard({
  presence = presenceState(membership, roster, presenceOwnPrincipalReceived('me')),
  myRole = 'owner' as Workspace['myRole'],
  memberCount = 4,
  focusTargets = {
    ada: { workspaceId: 'ws-1', agentId: 'agent-1' },
    bob: { workspaceId: 'ws-1', noteId: 'note-1' },
    cy: { workspaceId: 'ws-1' },
  } as Record<string, PresenceFocusItem>,
  otherWorkspaces = [] as Workspace[],
} = {}) {
  const admitted = withLegacyPrincipal(mocks.state);
  Object.assign(mocks.state, admitted);
  mocks.state.presence = { ...presence, context: selectPrincipalActionContext.select(admitted) };
  mocks.state.workspace.workspaces = createCollection('id', [
    { id: WorkspaceId('ws-1'), title: 'Shared Workspace', ownerPrincipalId: 'me', memberCount },
    ...otherWorkspaces,
  ] as Workspace[]);
  mocks.state.presenceFollow = presenceFollowReducer(undefined, { type: 'init' });
  const scope = selectPresenceFollowScope.select(mocks.state as never);
  if (scope) {
    let follow = presenceFollowReducer(
      undefined,
      presenceFollowScopeChanged(scope, selectPrincipalActionContext.select(admitted), 'ws-1'),
    );
    for (const [principalId, target] of Object.entries(focusTargets))
      follow = presenceFollowReducer(
        follow,
        presenceFollowFrameReceived(scope, principalId, { generation: 1, seq: 0, target }),
      );
    mocks.state.presenceFollow = follow;
  }
  mocks.workspaceEntity = { ...mocks.workspaceEntity, myRole } as Workspace;
  const WorkspaceProgressCard = (await import('../WorkspaceProgressCard.svelte')).default;
  const view = render(WorkspaceProgressCard, { props: { workspaceId: 'ws-1' } });
  await tick();
  // The store mock reads readable selector args once per notification; the
  // card sets its workspace-id store in an $effect, so re-notify to pick it up.
  const { store } = await import('$store/renderer/store');
  (store as unknown as { emitState: () => void }).emitState();
  await tick();
  return view;
}

const presenceRow = () => document.querySelector('[data-sidebar-presence-row]');
const personButton = (principalId: string) =>
  document.querySelector<HTMLButtonElement>(`[data-presence-person-button="${principalId}"]`)!;

warmImport(() => import('../../../terminal/__tests__/mocks/MockButton.svelte'));
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceProgressCard.svelte'));

describe('WorkspaceProgressCard presence row', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.navigateToNote.mockClear();
    mocks.notes.length = 0;
    mocks.agents.length = 0;
    mocks.state.userPreferences = { labsMultiplayerEnabled: true };
  });

  it('renders nothing for an unshared workspace, keeping the rest of the metadata block', async () => {
    const { container } = await renderProgressCard({
      presence: presenceState(
        presenceMembersReceived('ws-1', [accepted('me', 'owner')]),
        presenceOwnPrincipalReceived('me'),
      ),
      memberCount: 1,
    });
    expect(presenceRow()).toBeNull();
    expect(container.querySelector('[data-sidebar-repository-branch-metadata]')).toBeTruthy();
  });

  /**
   * The ring is a box-shadow on the avatar element; a CSS `filter` greyscales
   * everything that element paints, ring included. So the greyscale must sit
   * on a descendant tile (image or initials) and never on the ringed element.
   */
  const greyscaleTile = (avatar: HTMLElement) =>
    avatar.querySelector<HTMLElement>('[data-presence-avatar-tile]');
  const expectGreyscaleBelowRing = (avatar: HTMLElement) => {
    expect(avatar.classList.contains('grayscale')).toBe(false);
    expect(avatar.classList.contains('opacity-50')).toBe(false);
    const tile = greyscaleTile(avatar);
    expect(tile).not.toBeNull();
    expect(tile).not.toBe(avatar);
    expect(avatar.contains(tile)).toBe(true);
    expect(tile!.classList.contains('grayscale')).toBe(true);
  };
  const expectFullColour = (avatar: HTMLElement) => {
    expect(avatar.classList.contains('grayscale')).toBe(false);
    expect(greyscaleTile(avatar)!.classList.contains('grayscale')).toBe(false);
  };

  it('badges each member with their identity forge and names it on hover; a row without one stays neutral', async () => {
    await renderProgressCard({
      presence: presenceState(
        presenceMembersReceived('ws-1', [
          accepted('me', 'owner'),
          {
            ...accepted('ada', 'collaborator'),
            identity: { provider: 'gitlab', host: 'gitlab.example.com', externalUserId: '7' },
          },
          {
            ...accepted('bob', 'collaborator'),
            identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
          },
          accepted('cy', 'collaborator'),
        ]),
        roster,
        presenceOwnPrincipalReceived('me'),
      ),
    });
    const badge = (principalId: string) =>
      presenceRow()!.querySelector<HTMLElement>(
        `[data-presence-avatar="${principalId}"] [data-presence-identity-provider]`,
      );
    expect(badge('ada')?.getAttribute('data-presence-identity-provider')).toBe('gitlab');
    expect(badge('ada')?.getAttribute('data-presence-identity-host')).toBe('gitlab.example.com');
    expect(badge('ada')?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('gitlab');
    expect(badge('bob')?.getAttribute('data-presence-identity-provider')).toBe('github');
    expect(badge('bob')?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('github');
    expect(badge('cy')).toBeNull();

    expect(personButton('ada').getAttribute('aria-label')).toContain('@ada on gitlab.example.com');
    expect(personButton('bob').getAttribute('aria-label')).toContain('@bob on GitHub');
    expect(personButton('cy').getAttribute('aria-label')).not.toMatch(/GitHub|gitlab/);
  });

  it('still shows every other member, each greyscale with a grey ring, while nobody else is online', async () => {
    await renderProgressCard({
      presence: presenceState(membership, presenceOwnPrincipalReceived('me')),
    });
    const row = presenceRow()!;
    const avatars = Array.from(row.querySelectorAll<HTMLElement>('[data-presence-avatar]'));
    expect(avatars.map((a) => a.getAttribute('data-presence-avatar'))).toEqual([
      'ada',
      'bob',
      'cy',
    ]);
    for (const avatar of avatars) {
      expect(avatar.hasAttribute('data-presence-offline')).toBe(true);
      expect(avatar.getAttribute('data-presence-ring')).toBe('offline');
      expectGreyscaleBelowRing(avatar);
    }
    expect(personButton('cy').getAttribute('aria-disabled')).toBe('true');
    // The group name must not announce the offline members as present.
    const group = row.querySelector('[data-presence-avatar-stack]')!;
    expect(group.getAttribute('aria-label')).not.toMatch(/here$/);
    expect(group.getAttribute('aria-label')).toMatch(/not here|none here/i);
  });

  it.each([
    { provider: 'github', host: 'github.com', platform: 'GitHub' },
    { provider: 'gitlab', host: 'gitlab.example.com', platform: 'gitlab.example.com' },
  ] as const)(
    'does not repeat fallback handles in $provider offline tooltips',
    async ({ provider, host, platform }) => {
      await renderProgressCard({
        presence: presenceState(
          presenceMembersReceived('ws-1', [
            accepted('me', 'owner'),
            ...[null, 'ada', 'Ada Lovelace'].map((displayName, index) => ({
              ...accepted(`person-${index}`, 'collaborator'),
              login: 'ada',
              displayName,
              identity: { provider, host, externalUserId: String(index) },
            })),
          ]),
          presenceOwnPrincipalReceived('me'),
        ),
      });
      for (const index of [0, 1]) {
        expect(personButton(`person-${index}`).getAttribute('aria-label')).toBe(
          `@ada on ${platform} · offline`,
        );
      }
      expect(personButton('person-2').getAttribute('aria-label')).toBe(
        `Ada Lovelace · @ada on ${platform} · offline`,
      );
    },
  );

  it('names the group by the people present, leaving the listed offline members out of the count', async () => {
    await renderProgressCard({
      presence: presenceState(
        membership,
        presenceRosterReceived({
          workspaceId: 'ws-1',
          members: [
            rosterMember('me', [{ workspaceId: 'ws-1' }]),
            rosterMember('ada', [{ workspaceId: 'ws-1' }]),
          ],
        }),
        presenceOwnPrincipalReceived('me'),
      ),
    });
    const row = presenceRow()!;
    expect(row.querySelectorAll('[data-presence-avatar]')).toHaveLength(3);
    expect(row.querySelector('[data-presence-avatar-stack]')!.getAttribute('aria-label')).toBe(
      '1 other person here',
    );
  });

  it('keeps the owner ring on an offline owner and greys only online-less members, never an online one', async () => {
    await renderProgressCard({
      presence: presenceState(
        membership,
        presenceRosterReceived({
          workspaceId: 'ws-1',
          members: [
            rosterMember('ada', [{ workspaceId: 'ws-1' }]),
            rosterMember('bob', [{ workspaceId: 'ws-1' }]),
          ],
        }),
        presenceOwnPrincipalReceived('ada'),
      ),
      myRole: 'collaborator',
    });
    const row = presenceRow()!;
    const avatar = (principalId: string) =>
      row.querySelector<HTMLElement>(`[data-presence-avatar="${principalId}"]`)!;
    // Owner first (even offline), then the online member, then the offline one.
    expect(
      Array.from(row.querySelectorAll('[data-presence-avatar]')).map((a) =>
        a.getAttribute('data-presence-avatar'),
      ),
    ).toEqual(['me', 'bob', 'cy']);
    expect(avatar('me').getAttribute('data-presence-ring')).toBe('owner');
    expect(avatar('me').hasAttribute('data-presence-offline')).toBe(true);
    expectGreyscaleBelowRing(avatar('me'));
    expect(avatar('cy').getAttribute('data-presence-ring')).toBe('offline');
    expect(avatar('cy').hasAttribute('data-presence-offline')).toBe(true);
    expectGreyscaleBelowRing(avatar('cy'));
    expect(avatar('bob').getAttribute('data-presence-ring')).toBe('member');
    expect(avatar('bob').hasAttribute('data-presence-offline')).toBe(false);
    expectFullColour(avatar('bob'));
    expect(presenceRow()!.querySelector('[data-presence-avatar="ada"]')).toBeNull();
  });

  it('shows one button per other member after the repo/branch row, never the viewer', async () => {
    const { container } = await renderProgressCard();
    const row = presenceRow()!;
    expect(
      row.previousElementSibling?.hasAttribute('data-sidebar-repository-branch-metadata'),
    ).toBe(true);
    expect(container.querySelector('[data-sidebar-workspace-metadata]')?.contains(row)).toBe(true);
    const buttons = Array.from(row.querySelectorAll<HTMLElement>('[data-presence-person-button]'));
    expect(buttons.map((b) => b.getAttribute('data-presence-person-button'))).toEqual([
      'ada',
      'bob',
      'cy',
    ]);
    expect(row.querySelector('[data-presence-avatar="me"]')).toBeNull();
    expect(screen.getByRole('button', { name: /^ada/ })).toBe(personButton('ada'));
  });

  it('requests following the agent chat or note a person is on', async () => {
    mocks.agents.push({ id: 'agent-1', name: 'Coordinator', isStreaming: false });
    mocks.notes.push({ id: 'note-1', title: 'Design' } as Note);
    await renderProgressCard();

    expect(personButton('ada').getAttribute('aria-label')).toContain('Coordinator');
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'ada', 1, 0, expect.any(String), undefined, false],
      }),
    );

    expect(personButton('bob').getAttribute('aria-label')).toContain('Design');
    await fireEvent.click(personButton('bob'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'bob', 1, 0, expect.any(String), undefined, false],
      }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openShareDialog.type }),
    );
  });

  it.each([
    { label: 'offline', members: [] },
    { label: 'online without a known destination', members: [rosterMember('cy', [])] },
  ])('does not open Share for an $label person', async ({ members }) => {
    mocks.state.userPreferences = { labsMultiplayerEnabled: true };
    await renderProgressCard({
      myRole: 'owner',
      focusTargets: {},
      presence: presenceState(
        membership,
        presenceRosterReceived({ workspaceId: 'ws-1', members }),
        presenceOwnPrincipalReceived('me'),
      ),
    });
    const cy = personButton('cy');
    await fireEvent.click(cy);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openShareDialog.type }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: followPresencePersonRequested.type }),
    );
    expect(mocks.navigateToNote).not.toHaveBeenCalled();
    expect(cy.getAttribute('aria-disabled')).toBe('true');
  });

  it('names a reachable closed workspace and requests its reported view', async () => {
    await renderProgressCard({
      otherWorkspaces: [{ id: WorkspaceId('closed'), title: 'Shared destination' } as Workspace],
      focusTargets: { ada: { workspaceId: 'closed', noteId: 'spec' } },
    });
    expect(personButton('ada').getAttribute('aria-label')).toContain('Shared destination');
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'ada', 1, 0, expect.any(String), undefined, false],
      }),
    );
  });

  it('does not expose an unreachable destination in text or attributes and stays inert', async () => {
    await renderProgressCard({
      focusTargets: { ada: { workspaceId: 'hidden-workspace', noteId: 'secret-note' } },
    });
    expect(presenceRow()!.outerHTML).not.toMatch(/hidden-workspace|secret-note/);
    expect(personButton('ada').getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: followPresencePersonRequested.type }),
    );
  });

  it('follows a bare workspace without inventing an agent or note', async () => {
    await renderProgressCard();
    await fireEvent.click(personButton('cy'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'cy', 1, 0, expect.any(String), undefined, false],
      }),
    );
  });

  it('refuses a captured click after focus changed without a render', async () => {
    await renderProgressCard();
    const button = personButton('ada');
    const follow = mocks.state.presenceFollow as ReturnType<typeof presenceFollowReducer>;
    mocks.state.presenceFollow = presenceFollowReducer(
      follow,
      presenceFollowFrameReceived(follow.scope!, 'ada', { generation: 1, seq: 1, target: null }),
    );
    await fireEvent.click(button);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: followPresencePersonRequested.type }),
    );
  });

  it('opens the agent chat in an adjacent panel on a modifier click from within a panel', async () => {
    mocks.agents.push({ id: 'agent-1', name: 'Coordinator', isStreaming: false });
    const { container } = await renderProgressCard();
    const panel = document.createElement('div');
    panel.setAttribute('data-panel-id', 'panel-7');
    panel.append(container);
    document.body.append(panel);

    await fireEvent.click(personButton('ada'), { ctrlKey: true });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'ada', 1, 0, expect.any(String), 'panel-7', true],
      }),
    );
  });

  it('leaves such a person inert for a non-owner, without dimming the avatar', async () => {
    await renderProgressCard({
      myRole: 'collaborator',
      focusTargets: { ada: { workspaceId: 'ws-1', agentId: 'agent-1' } },
    });
    const cy = personButton('cy');
    expect(cy.getAttribute('aria-disabled')).toBe('true');
    // The button base variant dims aria-disabled buttons; the avatar stays solid.
    expect(cy.classList.contains('aria-disabled:opacity-100')).toBe(true);
    expect(cy.classList.contains('aria-disabled:opacity-50')).toBe(false);
    await fireEvent.click(cy);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openShareDialog.type }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: followPresencePersonRequested.type }),
    );
    expect(mocks.navigateToNote).not.toHaveBeenCalled();
    // ada's agent focus still opens the chat regardless of role.
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: followPresencePersonRequested.type,
        payload: [expect.any(String), 'ada', 1, 0, expect.any(String), undefined, false],
      }),
    );
  });
});

describe('presence rollout mounted boundary', () => {
  it('hides the complete row when Multiplayer is disabled, including focused avatars', async () => {
    mocks.state.userPreferences = { labsMultiplayerEnabled: false };
    await renderProgressCard();
    expect(presenceRow()).toBeNull();
    expect(document.querySelector('[data-presence-person-button]')).toBeNull();
  });
  it('refuses a captured avatar click after admission invalidation', async () => {
    mocks.state.userPreferences = { labsMultiplayerEnabled: true };
    mocks.dispatch.mockClear();
    await renderProgressCard();
    const button = personButton('ada');
    mocks.state.userPreferences = { labsMultiplayerEnabled: false };
    await fireEvent.click(button);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: followPresencePersonRequested.type }),
    );
  });
});
