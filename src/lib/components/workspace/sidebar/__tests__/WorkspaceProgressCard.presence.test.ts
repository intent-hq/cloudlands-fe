/**
 * @vitest-environment jsdom
 *
 * The workspace sidebar's presence row: the production people selectors run
 * over real presence + workspace state, and each avatar takes the viewer to
 * where that person looks (agent chat, else note) or falls back to Share.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { PresenceMember } from '$shared/types/presence';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
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
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
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
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => []),
  selectHidesOwnerWorkspaceActions: mocks.selector(() => false),
}));
vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
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
  actions.reduce((state, action) => presenceReducer(state, action), presenceInitialState);
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
} = {}) {
  mocks.state.presence = presence;
  mocks.state.workspace.workspaces = createCollection('id', [
    { id: WorkspaceId('ws-1'), title: 'Shared Workspace', ownerPrincipalId: 'me', memberCount },
  ] as Workspace[]);
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
    expect(personButton('cy').getAttribute('aria-label')).toMatch(/offline/i);
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
    const avatar = (principalId: string) =>
      presenceRow()!.querySelector<HTMLElement>(`[data-presence-avatar="${principalId}"]`)!;
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

  it('takes the viewer to the agent chat or note a person is on', async () => {
    mocks.agents.push({ id: 'agent-1', name: 'Coordinator', isStreaming: false });
    mocks.notes.push({ id: 'note-1', title: 'Design' } as Note);
    await renderProgressCard();

    expect(personButton('ada').getAttribute('aria-label')).toContain('Coordinator');
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openAgentTabRequested('ws-1', {
        agentId: 'agent-1',
        sourcePanelId: undefined,
        openInAdjacentPanel: false,
      }),
    );

    expect(personButton('bob').getAttribute('aria-label')).toContain('Design');
    await fireEvent.click(personButton('bob'));
    expect(mocks.navigateToNote).toHaveBeenCalledWith('note-1', { workspaceId: 'ws-1' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openShareDialog.type }),
    );
  });

  it('opens the Share screen for the owner when a person has no agent or note focus', async () => {
    await renderProgressCard({ myRole: 'owner' });
    const cy = personButton('cy');
    expect(cy.hasAttribute('aria-disabled')).toBe(false);
    await fireEvent.click(cy);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'Shared Workspace' }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openAgentTabRequested.type }),
    );
    expect(mocks.navigateToNote).not.toHaveBeenCalled();
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
      openAgentTabRequested('ws-1', {
        agentId: 'agent-1',
        sourcePanelId: 'panel-7',
        openInAdjacentPanel: true,
      }),
    );
  });

  it('leaves such a person inert for a non-owner', async () => {
    await renderProgressCard({ myRole: 'collaborator' });
    const cy = personButton('cy');
    expect(cy.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(cy);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openShareDialog.type }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: openAgentTabRequested.type }),
    );
    expect(mocks.navigateToNote).not.toHaveBeenCalled();
    // ada's agent focus still opens the chat regardless of role.
    await fireEvent.click(personButton('ada'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: openAgentTabRequested.type,
        payload: ['ws-1', expect.objectContaining({ agentId: 'agent-1' })],
      }),
    );
  });
});
