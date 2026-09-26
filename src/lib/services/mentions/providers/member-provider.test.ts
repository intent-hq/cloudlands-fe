import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus, type Workspace } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import { restoreStoredSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import {
  presenceMembersReceived,
  presenceOwnPrincipalReceived,
  presenceReset,
  presenceRosterReceived,
} from '$store/renderer/slices/presence/presence-slice';
import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setBundledSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { MentionSystem } from '../mention-system';
import type { MentionCandidate } from '../types';
import { providerRegistry } from './index';

const mocks = vi.hoisted(() => ({ request: vi.fn(), notes: vi.fn(), workspaces: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', () => ({
  appClient: { notes: { list: mocks.notes }, workspaces: { list: mocks.workspaces } },
}));
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ typingSource: 'own-source' })),
}));

const owner: WorkspaceMember = {
  principalId: 'owner-id',
  login: 'Octocat',
  displayName: 'Octo Cat',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-14T12:00:00.000Z',
  identity: { provider: 'github', host: 'github.com', externalUserId: '583231' },
};
const collaborator: WorkspaceMember = {
  principalId: 'guest-id',
  login: 'Alice.Dev',
  displayName: 'Alice',
  avatarUrl: 'https://gitlab.com/uploads/alice.png',
  role: 'collaborator',
  addedAt: '2026-09-15T09:00:00.000Z',
  identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '4711' },
};
const another: WorkspaceMember = {
  ...collaborator,
  principalId: 'another-id',
  login: 'bob',
  identity: { provider: 'gitlab', host: 'code.example:8443', externalUserId: '4711' },
};

const memberResults = (results: MentionCandidate[]) => results.filter((r) => r.type === 'member');
const principalIds = (results: MentionCandidate[]) =>
  memberResults(results).map((r) => r.meta?.principalId);

describe('workspace member mention search', () => {
  let dispose: () => void;
  let cancelSaga: (() => void) | undefined;
  let system: MentionSystem;

  function workspace(id = 'ws-1', memberCount = 3, myRole: Workspace['myRole'] = 'owner') {
    return {
      id: WorkspaceId(id),
      title: id,
      memberCount,
      myRole,
      ownerPrincipalId: 'owner-id',
    } as Workspace;
  }

  function seed(members = [owner, collaborator, another], self: string | null = 'owner-id') {
    store.dispatch(replaceWorkspaceList([workspace()]));
    store.dispatch(presenceMembersReceived('ws-1', members));
    store.dispatch(presenceOwnPrincipalReceived(self));
  }

  beforeEach(() => {
    dispose = store.init();
    system = new MentionSystem({ debounceMs: 0 });
    mocks.request.mockReset().mockResolvedValue({ files: [], terminals: [], scripts: [] });
    mocks.notes.mockReset().mockResolvedValue([]);
    mocks.workspaces.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cancelSaga?.();
    cancelSaga = undefined;
    system.destroy();
    dispose();
    vi.useRealTimers();
  });

  it.each([
    ['owner-id', 'owner', ['guest-id', 'another-id']],
    ['guest-id', 'collaborator', ['owner-id', 'another-id']],
  ] as const)('offers other accepted offline members to %s', async (self, role, expected) => {
    seed(undefined, self);
    store.dispatch(replaceWorkspaceList([workspace('ws-1', 3, role)]));
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual(expected);
  });

  it('filters GitHub and dotted GitLab handles case-insensitively through the default search pipeline', async () => {
    seed(undefined, 'another-id');
    expect(principalIds(await system.search('oCtO', { workspaceId: 'ws-1' }))).toEqual([
      'owner-id',
    ]);
    const matches = memberResults(await system.search('ICE.DE', { workspaceId: 'ws-1' }));
    expect(matches).toMatchObject([
      {
        id: 'member-guest-id',
        type: 'member',
        label: 'Alice.Dev',
        uri: 'devspace://member/guest-id?workspaceId=ws-1',
        meta: {
          workspaceId: 'ws-1',
          principalId: 'guest-id',
          identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '4711' },
        },
      },
    ]);
    expect(principalIds(await system.search('no-such-handle', { workspaceId: 'ws-1' }))).toEqual(
      [],
    );
  });

  it('keeps equal handles and equal external IDs distinct across providers and hosts', async () => {
    seed([
      owner,
      collaborator,
      {
        ...collaborator,
        principalId: 'github-alice',
        identity: { provider: 'github', host: 'github.com', externalUserId: '4711' },
      },
      { ...another, login: 'Alice.Dev' },
    ]);
    const results = memberResults(await system.search('alice', { workspaceId: 'ws-1' }));
    expect(principalIds(results).sort()).toEqual(['another-id', 'github-alice', 'guest-id']);
    expect(new Set(results.map((r) => r.uri)).size).toBe(3);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'member-guest-id',
          subtitle: expect.stringContaining('gitlab.com'),
        }),
        expect.objectContaining({
          id: 'member-github-alice',
          subtitle: expect.stringContaining('github.com'),
        }),
        expect.objectContaining({
          id: 'member-another-id',
          subtitle: expect.stringContaining('code.example:8443'),
        }),
      ]),
    );
  });

  it('excludes self by principal, not by a shared login', async () => {
    seed([owner, { ...collaborator, login: 'Octocat' }]);
    expect(principalIds(await system.search('octocat', { workspaceId: 'ws-1' }))).toEqual([
      'guest-id',
    ]);
  });

  it('does not infer a forge for legacy rows or require display names and avatars', async () => {
    seed([
      owner,
      { ...collaborator, identity: undefined, displayName: null, avatarUrl: null },
      { ...another, login: null },
      { ...another, principalId: 'blank-login', login: '' },
    ]);
    const results = memberResults(await system.search('', { workspaceId: 'ws-1' }));
    expect(principalIds(results)).toEqual(['guest-id']);
    expect(results[0].label).toBe('Alice.Dev');
    expect(results[0].meta?.identity).toBeUndefined();
    expect(results[0].subtitle).toBeUndefined();
  });

  it('requires known self, a shared workspace, and accepted membership', async () => {
    seed(undefined, null);
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([]);
    store.dispatch(presenceOwnPrincipalReceived('owner-id'));
    store.dispatch(replaceWorkspaceList([workspace('ws-1', 1), workspace('ws-2')]));
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([]);
    expect(principalIds(await system.search('', { workspaceId: 'ws-2' }))).toEqual([]);
    expect(principalIds(await system.search('', { repoPath: '/repo' }))).toEqual([]);
    expect(principalIds(await system.search('', { workspaceId: 'missing' }))).toEqual([]);
  });

  it('does not treat online nonmembers or members of another workspace as accepted members', async () => {
    seed([owner, collaborator]);
    store.dispatch(presenceMembersReceived('ws-2', [another]));
    store.dispatch(
      presenceRosterReceived({
        workspaceId: 'ws-1',
        members: [
          {
            principalId: 'pending-id',
            login: 'pending',
            displayName: null,
            avatarUrl: null,
            focus: [],
            typing: [],
          },
        ],
      }),
    );
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual(['guest-id']);
  });

  it('updates repeated searches on removal, profile change, own-principal change, and unsharing', async () => {
    seed();
    const search = () => system.search('', { workspaceId: 'ws-1' });
    expect(principalIds(await search())).toEqual(['guest-id', 'another-id']);
    store.dispatch(
      presenceMembersReceived('ws-1', [owner, { ...collaborator, login: 'renamed.dev' }]),
    );
    expect(memberResults(await search()).map((r) => r.label)).toEqual(['renamed.dev']);
    store.dispatch(presenceOwnPrincipalReceived('guest-id'));
    expect(principalIds(await search())).toEqual(['owner-id']);
    store.dispatch(replaceWorkspaceList([workspace('ws-1', 1)]));
    expect(principalIds(await search())).toEqual([]);
  });

  it('keeps workspaces and backend resets out of a previous context’s cache', async () => {
    seed();
    store.dispatch(replaceWorkspaceList([workspace(), workspace('ws-2')]));
    store.dispatch(presenceMembersReceived('ws-2', [owner, another]));
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([
      'guest-id',
      'another-id',
    ]);
    expect(principalIds(await system.search('', { workspaceId: 'ws-2' }))).toEqual(['another-id']);
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    store.dispatch(presenceReset());
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([]);
    seed([owner, another]);
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual(['another-id']);
  });

  it.each(['membership', 'backend'])(
    'drops an in-flight search overtaken by a %s change',
    async (change) => {
      seed();
      let resolveNotes!: (notes: []) => void;
      mocks.notes.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNotes = resolve;
          }),
      );
      const searching = system.search('', { workspaceId: 'ws-1' });
      await vi.waitFor(() => expect(resolveNotes).toBeTypeOf('function'));
      if (change === 'backend') {
        store.dispatch(
          connectionsListReceived({
            connections: [],
            activeId: 'remote',
            windowBackendId: 'remote',
          }),
        );
        store.dispatch(presenceReset());
        seed();
      }
      store.dispatch(presenceMembersReceived('ws-1', [owner, another]));
      resolveNotes([]);
      expect(principalIds(await searching)).toEqual([]);
      expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([
        'another-id',
      ]);
    },
  );

  it('does not revive removed members from the synchronous fallback cache', async () => {
    seed();
    system.searchSync('', { workspaceId: 'ws-1' });
    await vi.waitFor(() =>
      expect(principalIds(system.searchSync('', { workspaceId: 'ws-1' }))).toContain('guest-id'),
    );
    store.dispatch(presenceMembersReceived('ws-1', [owner, another]));
    expect(principalIds(system.searchSync('', { workspaceId: 'ws-1' }))).not.toContain('guest-id');
    await vi.waitFor(() =>
      expect(principalIds(system.searchSync('', { workspaceId: 'ws-1' }))).toEqual(['another-id']),
    );
  });

  it('reads only current Redux membership when the member provider is queried repeatedly', async () => {
    seed();
    const provider = providerRegistry.get('member');
    expect(provider).toBeDefined();
    expect(principalIds(await provider!.search('alice', { workspaceId: 'ws-1' }))).toEqual([
      'guest-id',
    ]);
    expect(principalIds(await provider!.search('', { workspaceId: 'ws-1' }))).toEqual([
      'guest-id',
      'another-id',
    ]);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('keeps file, note, agent, and specialist results alongside workspace members', async () => {
    seed();
    mocks.request.mockResolvedValue({
      requestId: 'search-1',
      files: ['src/example.ts'],
      truncated: false,
      terminals: [],
      scripts: [],
    });
    mocks.notes.mockResolvedValue([{ id: 'note-1', title: 'Plan', content: '' }]);
    store.dispatch(
      restoreStoredSessions([
        {
          id: AgentId('agent-1'),
          backendSessionId: null,
          workspaceId: WorkspaceId('ws-1'),
          name: 'Helper',
          status: AgentStatus.Active,
          messages: [],
          createdAt: '2026-09-14T12:00:00.000Z',
          updatedAt: '2026-09-14T12:00:00.000Z',
        },
      ]),
    );
    store.dispatch(
      setBundledSpecialists([
        {
          id: 'implementor',
          name: 'Implementor',
          description: 'Implements tasks',
          defaultBehaviorPrompt: '',
        },
      ]),
    );
    const results = await system.search('', { workspaceId: 'ws-1' });
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'file', uri: 'file:src/example.ts' }),
        expect.objectContaining({ type: 'note', label: 'Plan' }),
        expect.objectContaining({ type: 'agent', id: 'agent-1' }),
        expect.objectContaining({ type: 'specialist', id: 'specialist-implementor' }),
        expect.objectContaining({ type: 'member', id: 'member-guest-id' }),
      ]),
    );
  });

  it('gets provider identity through the existing membership wire lifecycle and resets on a backend switch', async () => {
    vi.useFakeTimers();
    store.dispatch(replaceWorkspaceList([workspace()]));
    store.dispatch(openWorkspaceTab('ws-1'));
    let acceptedMembers = [owner, collaborator, another];
    mocks.request.mockImplementation(async (method: string) => {
      if (method === 'principal.me')
        return {
          id: 'owner-id',
          login: 'Octocat',
          displayName: 'Octo Cat',
          avatarUrl: null,
          isAdministrator: true,
          identity: { provider: 'github', host: 'github.com', externalUserId: '583231' },
        };
      if (method === 'workspace.members.list')
        return { members: acceptedMembers, guestCount: acceptedMembers.length - 1, guestLimit: 5 };
      if (method === 'presence.snapshot') return { workspaceId: 'ws-1', members: [] };
      return { files: [], terminals: [], scripts: [] };
    });
    cancelSaga = store.runSaga(presenceSaga);
    store.dispatch(daemonEventsSubscribed());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request.mock.calls.filter(([method]) => method === 'principal.me')).toEqual([
      ['principal.me', {}],
    ]);
    expect(
      mocks.request.mock.calls.filter(([method]) => method === 'workspace.members.list'),
    ).toEqual([['workspace.members.list', { workspaceId: 'ws-1' }]]);
    expect(
      memberResults(await system.search('', { workspaceId: 'ws-1' }))[0].meta?.identity,
    ).toEqual({ provider: 'gitlab', host: 'gitlab.com', externalUserId: '4711' });
    acceptedMembers = [owner, another];
    store.dispatch(replaceWorkspaceList([workspace('ws-1', 2)]));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      mocks.request.mock.calls.filter(([method]) => method === 'workspace.members.list'),
    ).toEqual([
      ['workspace.members.list', { workspaceId: 'ws-1' }],
      ['workspace.members.list', { workspaceId: 'ws-1' }],
    ]);
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual(['another-id']);
    mocks.request.mockImplementation((method: string) =>
      method === 'principal.me'
        ? new Promise(() => {})
        : Promise.resolve({ files: [], terminals: [], scripts: [] }),
    );
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'remote', windowBackendId: 'remote' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(principalIds(await system.search('', { workspaceId: 'ws-1' }))).toEqual([]);
  });
});
