/**
 * Saga → wire contract for the owner-side Share dialog. FAKE transport only:
 * `backendRequest` is mocked, so each test asserts the exact JSON-RPC method
 * + params (PROTOCOL §5.1 membership) and feeds a contract-shaped reply back.
 *
 * The regressions from the fe#2440 review ride here too: a daemon error
 * message never reaches a console sink or the rendered error (only bounded
 * codes are logged); owner-only RPCs are never issued from a collaborator
 * connection; a `-32003` withholds the dialog; a delayed create reply cannot
 * cross dialog sessions. Invite links are ordinary state: `createdLink.url`
 * after a create and `invite.url` on every listed open row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import {
  createCollection,
  getItem,
  getItems,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import type { Workspace, WorkspaceRole } from '$shared/types';
import {
  closeShareDialog,
  getRosterState,
  initialState,
  openShareDialog,
  shareDataLoaded,
  shareInviteCreated,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
  shareMembershipChanged,
  shareRosterLoaded,
  shareRosterMemberRemoveRequested,
  shareRosterRequested,
  workspaceShareReducer,
  type WorkspaceShareState,
} from '../workspace-share-slice';
import { workspaceShareSaga } from './workspace-share-saga';

const INVITE_URL = 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok-inv-2';
/** Rides only a mocked daemon error message; must never reach a sink. */
const LEAK_MARKER = 'daemon-message-LEAK-MARKER-9f3a';

const owner: WorkspaceMember = {
  principalId: 'p-alice',
  login: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'owner',
  addedAt: '2026-09-01T00:00:00Z',
};

const invite: WorkspaceInvite = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  createdByPrincipalId: 'p-alice',
  pinLogin: 'carol',
  pinGithubUserId: 3,
  url: 'intent://invite?v=1&h=example.test&p=5181&f=fp&t=tok-inv-1',
  createdAt: '2026-09-14T00:00:00Z',
  expiresAt: '2026-09-21T00:00:00Z',
};

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** Minimal root state: the share slice plus the workspace entity carrying `myRole`. */
function rootState(share: WorkspaceShareState, roles: Record<string, WorkspaceRole | undefined>) {
  const workspaces = Object.entries(roles).map(
    ([id, myRole]) => ({ id, title: id, myRole }) as unknown as Workspace,
  );
  return { workspaceShare: share, workspace: { workspaces: createCollection('id', workspaces) } };
}

function harness(
  seed: WorkspaceShareState = initialState,
  roles: Record<string, WorkspaceRole | undefined> = { 'ws-1': 'owner', 'ws-2': 'owner' },
) {
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = vi.fn((action) => {
    dispatched.push(action);
    state = workspaceShareReducer(state, action);
    channel.put(action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => rootState(state, roles) },
    workspaceShareSaga,
  );
  return { channel, dispatch, dispatched, task, state: () => state };
}

function opened(workspaceId = 'ws-1'): WorkspaceShareState {
  return workspaceShareReducer(
    initialState,
    openShareDialog({ workspaceId, workspaceTitle: 'My Space' }),
  );
}

function forbidden(): Error {
  return Object.assign(new Error('forbidden: capability denied'), { rpcCode: -32003 });
}

/** Reply per method so a read after a mutation gets list-shaped payloads. */
function replyByMethod(overrides: Record<string, unknown> = {}) {
  mocks.request.mockImplementation(async (method: string) => {
    if (method in overrides) {
      const reply = overrides[method];
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'function') return reply();
      return reply;
    }
    if (method === 'workspace.members.list') return { members: [owner] };
    if (method === 'workspace.invite.list') return { invites: [invite] };
    return {};
  });
}

function calls(method: string) {
  return mocks.request.mock.calls.filter(([m]) => m === method);
}

const createReply = (id = 'inv-2') => ({
  invite: { ...invite, id, pinLogin: 'dave', pinGithubUserId: 4, url: INVITE_URL },
  secret: 'tok-inv-2',
  url: INVITE_URL,
  hosts: ['example.test'],
  port: 5181,
  fingerprint: 'fp',
  version: 1,
});

describe('workspaceShareSaga', () => {
  const consoleSpies = { warn: vi.spyOn(console, 'warn'), error: vi.spyOn(console, 'error') };
  beforeEach(() => {
    consoleSpies.warn.mockImplementation(() => {});
    consoleSpies.error.mockImplementation(() => {});
  });
  afterEach(() => {
    mocks.request.mockReset();
    consoleSpies.warn.mockClear();
    consoleSpies.error.mockClear();
  });

  it('reads the roster and open invites for the target when the dialog opens', async () => {
    replyByMethod();
    const h = harness();

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.list', { workspaceId: 'ws-1' });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(h.state().loadStatus).toBe('loaded');
    expect(getItems(h.state().members)).toEqual([owner]);
    expect(getItems(h.state().invites)).toEqual([invite]);
    h.task.cancel();
  });

  it('records a localized load error when a read fails, without echoing the daemon message', async () => {
    replyByMethod({ 'workspace.invite.list': new Error('daemon unavailable') });
    const h = harness();

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();

    expect(h.state().loadStatus).toBe('error');
    expect(h.state().loadError).toEqual(expect.any(String));
    expect(JSON.stringify(h.dispatched)).not.toContain('daemon unavailable');
    h.task.cancel();
  });

  // Regression (fe#2440 review P1 / verifier #7): a collaborator connection
  // never issues `workspace.invite.*` / `workspace.members.remove` — the
  // dialog is withheld before any RPC leaves.
  it('withholds the dialog without any RPC when the caller is not the owner', async () => {
    replyByMethod();
    const h = harness(initialState, { 'ws-1': 'collaborator' });

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(h.state()).toMatchObject({ open: true, withheld: true, loadStatus: 'loaded' });

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    h.dispatch(shareInviteRevokeRequested('inv-1'));
    h.dispatch(shareMemberRemoveRequested('p-bob'));
    h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    h.task.cancel();
  });

  it('withholds the dialog when the workspace entity carries no role', async () => {
    replyByMethod();
    const h = harness(initialState, { 'ws-1': undefined });

    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(h.state().withheld).toBe(true);
    h.task.cancel();
  });

  // Regression (fe#2440 review P1): a `-32003` Forbidden reply withholds the
  // dialog — rows and controls gone — instead of surfacing a raw error.
  it('withholds the dialog on a -32003 refusal of any owner-only method', async () => {
    replyByMethod({ 'workspace.invite.list': forbidden() });
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();
    expect(h.state()).toMatchObject({ withheld: true, loadError: null });
    expect(getItems(h.state().members)).toEqual([]);
    h.task.cancel();

    for (const method of [
      'workspace.invite.create',
      'workspace.invite.revoke',
      'workspace.members.remove',
    ] as const) {
      mocks.request.mockReset();
      replyByMethod({ [method]: forbidden() });
      const loaded = workspaceShareReducer(
        opened(),
        shareDataLoaded({
          target: { workspaceId: 'ws-1', session: 1 },
          generation: 0,
          members: [owner],
          invites: [invite],
        }),
      );
      const hh = harness(loaded);
      hh.dispatch(
        method === 'workspace.invite.create'
          ? shareInviteCreateRequested({ pinLogin: '' })
          : method === 'workspace.invite.revoke'
            ? shareInviteRevokeRequested('inv-1')
            : shareMemberRemoveRequested('p-bob'),
      );
      await settle();
      expect(hh.state()).toMatchObject({ withheld: true, actionError: null, createError: null });
      expect(getItems(hh.state().members)).toEqual([]);
      expect(getItems(hh.state().invites)).toEqual([]);
      expect(JSON.stringify(hh.dispatched)).not.toContain('capability denied');
      hh.task.cancel();
    }
  });

  /** `invite.create` reply plus a list that includes the new row (as the daemon would). */
  const createdReplies = () => ({
    'workspace.invite.create': createReply(),
    'workspace.invite.list': {
      invites: [invite, { ...invite, id: 'inv-2', pinLogin: 'dave', url: INVITE_URL }],
    },
  });

  it('creates a pinned invite, keeps its link in state, and re-reads the invites', async () => {
    replyByMethod(createdReplies());
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: ' dave ' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.create', {
      workspaceId: 'ws-1',
      pinLogin: 'dave',
    });
    const { createdLink } = h.state();
    expect(h.state()).toMatchObject({ creating: false, createError: null, loadStatus: 'loaded' });
    expect(createdLink).toEqual({ inviteId: 'inv-2', url: INVITE_URL, pinLogin: 'dave' });
    expect(calls('workspace.invite.list')).toHaveLength(1);
    h.task.cancel();
  });

  // The link is plain state: it stays copyable from the created-link panel and
  // from the open-invite row the trailing read lists, and closing the dialog
  // drops only the panel (the row's `url` comes back with the next read).
  it('exposes the url on the created link and on the listed open invite row', async () => {
    replyByMethod(createdReplies());
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: 'dave' }));
    await settle();

    expect(h.state().createdLink?.url).toBe(INVITE_URL);
    expect(getItem(h.state().invites, 'inv-2')?.url).toBe(INVITE_URL);
    expect(getItem(h.state().invites, 'inv-1')?.url).toBe(invite.url);

    h.dispatch(closeShareDialog());
    await settle();
    expect(h.state().createdLink).toBeNull();
    h.task.cancel();
  });

  it('logs only bounded codes when a mutation fails with a message carrying daemon material', async () => {
    const leaky = Object.assign(new Error(`invite ${LEAK_MARKER} rejected`), { rpcCode: -32602 });
    replyByMethod({ 'workspace.invite.revoke': leaky });
    const h = harness(opened());

    h.dispatch(shareInviteRevokeRequested('inv-1'));
    await settle();

    expect(h.state().actionError).toEqual(expect.any(String));
    const sinks = JSON.stringify([
      h.dispatched,
      h.state(),
      consoleSpies.warn.mock.calls,
      consoleSpies.error.mock.calls,
    ]);
    expect(sinks).not.toContain(LEAK_MARKER);
    expect(consoleSpies.warn).toHaveBeenCalled();
    h.task.cancel();
  });

  // Regression (fe#2440 review P1): a delayed `workspace.invite.create` for
  // workspace A that resolves after the dialog was closed and reopened for
  // workspace B must not attach A's link under B.
  it('drops a delayed create reply once the dialog has been retargeted', async () => {
    let resolveCreate!: (value: unknown) => void;
    replyByMethod({
      'workspace.invite.create': () => new Promise((resolve) => (resolveCreate = resolve)),
    });
    const h = harness(opened('ws-1'));

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.create', { workspaceId: 'ws-1' });

    h.dispatch(closeShareDialog());
    h.dispatch(openShareDialog({ workspaceId: 'ws-2', workspaceTitle: 'B' }));
    await settle();
    resolveCreate(createReply('inv-A'));
    await settle();

    expect(h.state()).toMatchObject({ workspaceId: 'ws-2', creating: false, createdLink: null });
    // A's reply was dropped outright: no created action carries its link.
    expect(h.dispatched.map((a) => (a as { type: string }).type)).not.toContain(
      shareInviteCreated.type,
    );
    expect(JSON.stringify(h.dispatched)).not.toContain(INVITE_URL);
    // Only B's own read went out after the retarget — no re-read for A's link.
    expect(calls('workspace.invite.list').map(([, params]) => params)).toEqual([
      { workspaceId: 'ws-2' },
    ]);
    h.task.cancel();
  });

  it('omits pinLogin from the wire for an open invite', async () => {
    replyByMethod({ 'workspace.invite.create': createReply() });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.create', { workspaceId: 'ws-1' });
    h.task.cancel();
  });

  it('maps the invite-pin-unknown daemon code onto the localized inline error', async () => {
    const unknown = Object.assign(new Error('unknown GitHub login'), {
      data: { code: 'invite-pin-unknown' },
    });
    replyByMethod({ 'workspace.invite.create': unknown });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: 'nobody' }));
    await settle();

    expect(h.state().creating).toBe(false);
    expect(h.state().createError).toContain('@nobody');
    expect(h.state().createdLink).toBeNull();
    expect(calls('workspace.invite.list')).toHaveLength(0);
    h.task.cancel();
  });

  // Remote access off: the daemon's `Error::ListenerDown` (-32603,
  // `data.code = 'listener-down'`) gets the actionable inline error; any
  // other failure keeps the generic one.
  it('maps the listener-down daemon code onto the Remote Access inline error, others stay generic', async () => {
    const listenerDown = Object.assign(new Error('invite listener is down'), {
      rpcCode: -32603,
      data: { code: 'listener-down' },
    });
    replyByMethod({ 'workspace.invite.create': listenerDown });
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();

    expect(h.state().creating).toBe(false);
    const listenerDownError = h.state().createError;
    expect(listenerDownError).toContain('Remote Access');
    expect(h.state().createdLink).toBeNull();

    replyByMethod({
      'workspace.invite.create': Object.assign(new Error('boom'), { rpcCode: -32603 }),
    });
    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();

    expect(h.state().creating).toBe(false);
    expect(h.state().createError).not.toBeNull();
    expect(h.state().createError).not.toBe(listenerDownError);
    expect(h.state().createError).not.toContain('Remote Access');
    h.task.cancel();
  });

  // Regression (fe#2440 review P2): revoking the just-created invite retires
  // its one-time link.
  it('revokes an invite then re-reads, retiring the created link, and localizes a rejected revoke', async () => {
    replyByMethod({
      'workspace.invite.create': createReply('inv-2'),
      'workspace.invite.list': { invites: [invite, { ...invite, id: 'inv-2' }] },
      'workspace.invite.revoke': { revoked: true },
    });
    const h = harness(opened());
    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    await settle();
    expect(h.state().createdLink?.inviteId).toBe('inv-2');

    replyByMethod({ 'workspace.invite.revoke': { revoked: true } });
    h.dispatch(shareInviteRevokeRequested('inv-2'));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.invite.revoke', {
      workspaceId: 'ws-1',
      inviteId: 'inv-2',
    });
    expect(h.state()).toMatchObject({
      revokingInviteId: null,
      actionError: null,
      createdLink: null,
    });

    replyByMethod({ 'workspace.invite.revoke': new Error('nope: raw daemon text') });
    h.dispatch(shareInviteRevokeRequested('inv-1'));
    await settle();

    expect(h.state().revokingInviteId).toBeNull();
    expect(h.state().actionError).toEqual(expect.any(String));
    expect(h.state().actionError).not.toContain('raw daemon text');
    h.task.cancel();
  });

  it('removes a collaborator then re-reads the roster', async () => {
    replyByMethod({ 'workspace.members.remove': { removed: true } });
    const h = harness(opened());

    h.dispatch(shareMemberRemoveRequested('p-bob'));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('workspace.members.remove', {
      workspaceId: 'ws-1',
      principalId: 'p-bob',
    });
    expect(h.state()).toMatchObject({ removingPrincipalId: null, actionError: null });
    expect(calls('workspace.members.list')).toHaveLength(1);
    h.task.cancel();
  });

  // Regression (fe#2440 Augment review): the reducer admits one dialog
  // mutation at a time; a request it declined while another was in flight
  // must never reach the daemon, and must not cancel the admitted worker.
  it('issues no RPC for a revoke or remove the reducer declined mid-flight', async () => {
    let releaseRevoke!: () => void;
    replyByMethod({
      'workspace.invite.revoke': () =>
        new Promise((resolve) => {
          releaseRevoke = () => resolve({ revoked: true });
        }),
      'workspace.members.remove': { removed: true },
    });
    const h = harness(opened());

    h.dispatch(shareInviteRevokeRequested('inv-1'));
    await settle();
    expect(h.state().revokingInviteId).toBe('inv-1');

    h.dispatch(shareInviteRevokeRequested('inv-2'));
    h.dispatch(shareMemberRemoveRequested('p-bob'));
    await settle();

    expect(calls('workspace.invite.revoke')).toEqual([
      ['workspace.invite.revoke', { workspaceId: 'ws-1', inviteId: 'inv-1' }],
    ]);
    expect(calls('workspace.members.remove')).toHaveLength(0);
    expect(h.state()).toMatchObject({ revokingInviteId: 'inv-1', removingPrincipalId: null });

    releaseRevoke();
    await settle();

    expect(h.state()).toMatchObject({ revokingInviteId: null, actionError: null });
    expect(calls('workspace.invite.revoke')).toHaveLength(1);
    expect(calls('workspace.members.remove')).toHaveLength(0);

    h.dispatch(shareMemberRemoveRequested('p-bob'));
    await settle();
    expect(calls('workspace.members.remove')).toEqual([
      ['workspace.members.remove', { workspaceId: 'ws-1', principalId: 'p-bob' }],
    ]);
    h.task.cancel();
  });

  // Regression (fe#2440 review P2 / verifier #8): a `workspace:updated`
  // membership delta from another client re-reads the open dialog's rows.
  it('re-reads on a membership change for the targeted workspace only', async () => {
    replyByMethod();
    const h = harness(opened());

    h.dispatch(shareMembershipChanged({ workspaceId: 'ws-other' }));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();

    replyByMethod({ 'workspace.invite.list': { invites: [] } });
    h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
    await settle();
    expect(calls('workspace.members.list')).toHaveLength(1);
    expect(calls('workspace.invite.list')).toHaveLength(1);
    expect(getItems(h.state().invites)).toEqual([]);
    h.task.cancel();
  });

  it('does nothing when the dialog is closed', async () => {
    replyByMethod();
    const h = harness();

    h.dispatch(shareInviteCreateRequested({ pinLogin: '' }));
    h.dispatch(shareInviteRevokeRequested('inv-1'));
    h.dispatch(shareMemberRemoveRequested('p-bob'));
    h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
    await settle();

    expect(mocks.request).not.toHaveBeenCalled();
    h.task.cancel();
  });

  // Regression (fe#2440 verifier, 6138cb4 round): a burst of membership
  // events while a read is on the wire must not fan out into N more reads —
  // one leading read, one trailing read once it settles, nothing else.
  it('coalesces a membership-event burst into one leading and one trailing read', async () => {
    const pending: Array<() => void> = [];
    mocks.request.mockImplementation(
      (method: string) =>
        new Promise((resolve) =>
          pending.push(() =>
            resolve(method === 'workspace.members.list' ? { members: [owner] } : { invites: [] }),
          ),
        ),
    );
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    for (let i = 0; i < 10; i++) h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
    await settle();
    expect(calls('workspace.invite.list')).toHaveLength(1);
    expect(calls('workspace.members.list')).toHaveLength(1);

    pending.splice(0).forEach((resolve) => resolve());
    await settle();
    expect(calls('workspace.invite.list')).toHaveLength(2);
    expect(calls('workspace.members.list')).toHaveLength(2);

    pending.splice(0).forEach((resolve) => resolve());
    await settle();
    expect(calls('workspace.invite.list')).toHaveLength(2);
    expect(h.state().loadStatus).toBe('loaded');
    h.task.cancel();
  });

  // Regression (fe#2440 review P2, f5f4a22): Create is permitted while the
  // initial read is deferred. The pre-create snapshot (an empty list) settling
  // after the create must not retire the created link; the trailing read is
  // the authoritative one and still lists the new invite.
  it('keeps the created link when a pre-create read settles after the create', async () => {
    let resolveInitialInvites!: () => void;
    let inviteReads = 0;
    mocks.request.mockImplementation((method: string) => {
      if (method === 'workspace.members.list') return Promise.resolve({ members: [owner] });
      if (method === 'workspace.invite.create') return Promise.resolve(createReply('inv-2'));
      if (method === 'workspace.invite.list') {
        inviteReads += 1;
        if (inviteReads === 1) {
          return new Promise((resolve) => (resolveInitialInvites = () => resolve({ invites: [] })));
        }
        return Promise.resolve({ invites: [{ ...invite, id: 'inv-2', pinLogin: 'dave' }] });
      }
      return Promise.resolve({});
    });
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();
    expect(h.state().loadStatus).toBe('loading');

    h.dispatch(shareInviteCreateRequested({ pinLogin: 'dave' }));
    await settle();
    expect(h.state().createdLink).toMatchObject({ inviteId: 'inv-2' });
    expect(calls('workspace.invite.list')).toHaveLength(1);

    resolveInitialInvites();
    await settle();
    // The stale snapshot did not clear the link; the trailing read ran.
    expect(h.state().createdLink).toMatchObject({ inviteId: 'inv-2' });
    expect(calls('workspace.invite.list')).toHaveLength(2);
    expect(h.state().loadStatus).toBe('loaded');
    expect(getItems(h.state().invites).map((row) => row.id)).toEqual(['inv-2']);
    expect(h.state().createdLink?.url).toBe(INVITE_URL);
    h.task.cancel();
  });

  // Regression (fe#2440 review P2, f5f4a22): one read rejecting while its
  // sibling is still outstanding must not release the single-flight guard —
  // later events would otherwise start a concurrent read per event.
  it('holds the flight until both reads settle when one of them rejects early', async () => {
    let resolveHungInvites!: () => void;
    let inviteReads = 0;
    mocks.request.mockImplementation((method: string) => {
      if (method === 'workspace.members.list') {
        return Promise.reject(new Error('members unavailable'));
      }
      if (method === 'workspace.invite.list') {
        inviteReads += 1;
        if (inviteReads === 1) {
          return new Promise((resolve) => (resolveHungInvites = () => resolve({ invites: [] })));
        }
        return Promise.resolve({ invites: [] });
      }
      return Promise.resolve({});
    });
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
    await settle();
    expect(h.state().loadStatus).toBe('loading');

    for (let i = 0; i < 10; i++) h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
    await settle();
    expect(calls('workspace.invite.list')).toHaveLength(1);
    expect(calls('workspace.members.list')).toHaveLength(1);

    resolveHungInvites();
    await settle();
    // One trailing read for the whole burst; the failure is still reported.
    expect(calls('workspace.invite.list')).toHaveLength(2);
    expect(calls('workspace.members.list')).toHaveLength(2);
    expect(h.state().loadStatus).toBe('error');
    h.task.cancel();
  });

  // Regression (fe#2440 review, b070c36): a -32003 on either read is terminal
  // and withholds the moment it arrives — not once the sibling read settles —
  // while the flight stays held until the sibling does, so a burst still
  // coalesces and no owner mutation is issued after the refusal.
  it.each(['workspace.members.list', 'workspace.invite.list'])(
    'withholds immediately on a -32003 from %s while the sibling read is still pending',
    async (refusedMethod) => {
      replyByMethod();
      const h = harness();
      h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'My Space' }));
      await settle();
      expect(getItems(h.state().invites)).toHaveLength(1);

      let settleSibling!: () => void;
      const siblingMethod =
        refusedMethod === 'workspace.members.list'
          ? 'workspace.invite.list'
          : 'workspace.members.list';
      mocks.request.mockImplementation((method: string) => {
        if (method === refusedMethod) return Promise.reject(forbidden());
        if (method === siblingMethod) {
          return new Promise((resolve) => {
            settleSibling = () =>
              resolve(
                siblingMethod === 'workspace.members.list'
                  ? { members: [owner] }
                  : { invites: [invite] },
              );
          });
        }
        return Promise.resolve({});
      });
      mocks.request.mockClear();
      h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
      await settle();
      expect(h.state()).toMatchObject({ withheld: true, loadStatus: 'loaded', loadError: null });
      expect(getItems(h.state().invites)).toHaveLength(0);

      // Denied: nothing owner-only leaves, and the burst is held behind the pending sibling.
      h.dispatch(shareMemberRemoveRequested('p-bob'));
      h.dispatch(shareInviteRevokeRequested('inv-1'));
      h.dispatch(shareInviteCreateRequested({ pinLogin: 'dave' }));
      for (let i = 0; i < 5; i++) h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
      await settle();
      expect(calls(refusedMethod)).toHaveLength(1);
      expect(calls(siblingMethod)).toHaveLength(1);

      settleSibling();
      await settle();
      expect(h.state().withheld).toBe(true);
      expect(calls('workspace.members.remove')).toHaveLength(0);
      expect(calls('workspace.invite.revoke')).toHaveLength(0);
      expect(calls('workspace.invite.create')).toHaveLength(0);
      h.task.cancel();
    },
  );

  it('reads the retargeted workspace after an in-flight read for the previous one settles', async () => {
    let resolveFirst!: () => void;
    let reads = 0;
    mocks.request.mockImplementation((method: string, params: { workspaceId: string }) => {
      if (method === 'workspace.invite.list') return Promise.resolve({ invites: [] });
      reads += 1;
      if (reads === 1) {
        return new Promise((resolve) => (resolveFirst = () => resolve({ members: [owner] })));
      }
      return Promise.resolve({ members: [{ ...owner, principalId: `p-${params.workspaceId}` }] });
    });
    const h = harness();
    h.dispatch(openShareDialog({ workspaceId: 'ws-1', workspaceTitle: 'A' }));
    await settle();
    h.dispatch(openShareDialog({ workspaceId: 'ws-2', workspaceTitle: 'B' }));
    await settle();
    resolveFirst();
    await settle();

    expect(calls('workspace.members.list').map(([, params]) => params)).toEqual([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ]);
    expect(h.state().workspaceId).toBe('ws-2');
    expect(getItems(h.state().members).map((member) => member.principalId)).toEqual(['p-ws-2']);
    h.task.cancel();
  });

  describe('hover-card roster (keyed by workspace)', () => {
    const guest: WorkspaceMember = {
      ...owner,
      principalId: 'p-guest',
      login: 'guest',
      displayName: null,
      role: 'collaborator',
    };
    const rosterOf = (h: ReturnType<typeof harness>, workspaceId: string) =>
      getItems(getRosterState(h.state(), workspaceId).members).map((m) => m.principalId);

    it('reads workspace.members.list for the requested workspace only', async () => {
      replyByMethod({ 'workspace.members.list': { members: [owner, guest] } });
      const h = harness();

      h.dispatch(shareRosterRequested({ workspaceId: 'ws-1' }));
      await settle();

      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(mocks.request).toHaveBeenCalledWith('workspace.members.list', { workspaceId: 'ws-1' });
      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice', 'p-guest']);
      expect(getRosterState(h.state(), 'ws-1').loadStatus).toBe('loaded');
      h.task.cancel();
    });

    // Regression (fe#2440 verifier, 6138cb4 round): the roster read failure
    // is logged as a bounded line — never the raw error, which may echo
    // whatever the daemon or transport put in its message.
    it('logs a bounded line, not the raw error, when the roster read fails', async () => {
      const marker = `leak-${Math.random().toString(36).slice(2)}`;
      replyByMethod({ 'workspace.members.list': new Error(`boom ${marker} ${LEAK_MARKER}`) });
      const h = harness();

      h.dispatch(shareRosterRequested({ workspaceId: 'ws-1' }));
      await settle();

      expect(getRosterState(h.state(), 'ws-1').loadStatus).toBe('error');
      const sinks = JSON.stringify([
        h.dispatched,
        h.state(),
        consoleSpies.warn.mock.calls,
        consoleSpies.error.mock.calls,
      ]);
      expect(sinks).not.toContain(marker);
      expect(sinks).not.toContain(LEAK_MARKER);
      h.task.cancel();
    });

    it('coalesces roster requests per workspace into one leading and one trailing read', async () => {
      const pending: Array<() => void> = [];
      mocks.request.mockImplementation(
        () => new Promise((resolve) => pending.push(() => resolve({ members: [owner] }))),
      );
      const h = harness();
      for (let i = 0; i < 10; i++) h.dispatch(shareRosterRequested({ workspaceId: 'ws-1' }));
      h.dispatch(shareRosterRequested({ workspaceId: 'ws-2' }));
      await settle();
      expect(calls('workspace.members.list').map(([, params]) => params)).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);

      pending.splice(0).forEach((resolve) => resolve());
      await settle();
      expect(calls('workspace.members.list').map(([, params]) => params)).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
        { workspaceId: 'ws-1' },
      ]);
      pending.splice(0).forEach((resolve) => resolve());
      await settle();
      expect(calls('workspace.members.list')).toHaveLength(3);
      h.task.cancel();
    });

    it('removes a collaborator for the owner, then re-reads that workspace only', async () => {
      replyByMethod({ 'workspace.members.remove': { removed: true } });
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
        shareRosterRequested({ workspaceId: 'ws-2' }),
        shareRosterLoaded({ workspaceId: 'ws-2', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded);

      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();

      expect(mocks.request).toHaveBeenCalledWith('workspace.members.remove', {
        workspaceId: 'ws-1',
        principalId: 'p-guest',
      });
      expect(calls('workspace.members.list').map(([, params]) => params)).toEqual([
        { workspaceId: 'ws-1' },
      ]);
      expect(getRosterState(h.state(), 'ws-1')).toMatchObject({
        removingPrincipalId: null,
        removeError: null,
      });
      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice']);
      expect(rosterOf(h, 'ws-2')).toEqual(['p-alice', 'p-guest']);
      h.task.cancel();
    });

    // Regression (fe#2440 verifier, 6138cb4 round): a removal started for
    // workspace A settles under A even when the card has moved to B — B's
    // rows are never filtered by A's outcome.
    it('settles a delayed removal under its own workspace, leaving another workspace roster intact', async () => {
      let resolveRemove!: () => void;
      replyByMethod({
        'workspace.members.remove': () =>
          new Promise((resolve) => (resolveRemove = () => resolve({ removed: true }))),
        'workspace.members.list': { members: [owner] },
      });
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded);

      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();
      replyByMethod({
        'workspace.members.remove': () => new Promise(() => {}),
        'workspace.members.list': { members: [owner, guest] },
      });
      h.dispatch(shareRosterRequested({ workspaceId: 'ws-2' }));
      await settle();
      expect(rosterOf(h, 'ws-2')).toEqual(['p-alice', 'p-guest']);

      replyByMethod({ 'workspace.members.list': { members: [owner] } });
      resolveRemove();
      await settle();

      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice']);
      expect(rosterOf(h, 'ws-2')).toEqual(['p-alice', 'p-guest']);
      expect(getRosterState(h.state(), 'ws-2').removingPrincipalId).toBeNull();
      h.task.cancel();
    });

    it('never issues the owner-only remove from a collaborator connection', async () => {
      replyByMethod();
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded, { 'ws-1': 'collaborator' });

      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();

      expect(calls('workspace.members.remove')).toHaveLength(0);
      expect(getRosterState(h.state(), 'ws-1').withheld).toBe(true);
      h.task.cancel();
    });

    // Regression (fe#2440 verifier, 6138cb4 round): a `-32003` on the hover
    // Remove withholds the card's owner controls for that workspace.
    it('withholds the workspace on a -32003 refusal and keeps the rows', async () => {
      replyByMethod({ 'workspace.members.remove': forbidden() });
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded);

      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();

      expect(getRosterState(h.state(), 'ws-1')).toMatchObject({
        withheld: true,
        removingPrincipalId: null,
        removeError: null,
      });
      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice', 'p-guest']);
      // Withheld: a later request for that workspace is not issued either.
      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();
      expect(calls('workspace.members.remove')).toHaveLength(1);
      h.task.cancel();
    });

    it('localizes a rejected removal without echoing the daemon error', async () => {
      const leaky = Object.assign(new Error(`cannot remove ${LEAK_MARKER}`), { rpcCode: -32602 });
      replyByMethod({ 'workspace.members.remove': leaky });
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded);

      h.dispatch(shareRosterMemberRemoveRequested({ workspaceId: 'ws-1', principalId: 'p-guest' }));
      await settle();

      expect(getRosterState(h.state(), 'ws-1').removeError).toEqual(expect.any(String));
      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice', 'p-guest']);
      const sinks = JSON.stringify([h.dispatched, h.state(), consoleSpies.warn.mock.calls]);
      expect(sinks).not.toContain(LEAK_MARKER);
      h.task.cancel();
    });

    it('re-reads a tracked roster on a membership change for that workspace only', async () => {
      replyByMethod({ 'workspace.members.list': { members: [owner] } });
      const seeded = [
        shareRosterRequested({ workspaceId: 'ws-1' }),
        shareRosterLoaded({ workspaceId: 'ws-1', members: [owner, guest] }),
      ].reduce(workspaceShareReducer, initialState);
      const h = harness(seeded);

      h.dispatch(shareMembershipChanged({ workspaceId: 'ws-2' }));
      await settle();
      expect(mocks.request).not.toHaveBeenCalled();

      h.dispatch(shareMembershipChanged({ workspaceId: 'ws-1' }));
      await settle();
      expect(calls('workspace.members.list').map(([, params]) => params)).toEqual([
        { workspaceId: 'ws-1' },
      ]);
      expect(rosterOf(h, 'ws-1')).toEqual(['p-alice']);
      h.task.cancel();
    });
  });
});
