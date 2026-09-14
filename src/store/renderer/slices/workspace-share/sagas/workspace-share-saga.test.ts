/**
 * Saga → wire contract for the owner-side Share dialog. FAKE transport only:
 * `backendRequest` is mocked, so each test asserts the exact JSON-RPC method
 * + params (PROTOCOL §5.1 membership) and feeds a contract-shaped reply back.
 *
 * The regressions from the fe#2440 review ride here too: the invite secret
 * never reaches an action, the store, or a console sink (marker-based: the
 * mocked daemon returns `SECRET_MARKER` and every sink is scanned for it);
 * owner-only RPCs are never issued from a collaborator connection; a `-32003`
 * withholds the dialog; a delayed create reply cannot cross dialog sessions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { clearInviteLinks, readInviteLink } from '$features/workspace-sharing/invite-link-vault';
import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
import type { Workspace, WorkspaceRole } from '$shared/types';
import {
  closeShareDialog,
  initialState,
  openShareDialog,
  shareDataLoaded,
  shareInviteCreated,
  shareInviteCreateRequested,
  shareInviteRevokeRequested,
  shareMemberRemoveRequested,
  shareMembershipChanged,
  workspaceShareReducer,
  type WorkspaceShareState,
} from '../workspace-share-slice';
import { workspaceShareSaga } from './workspace-share-saga';

const SECRET_MARKER = 'tok-SECRET-MARKER-9f3a';
const INVITE_URL = `intent://invite?v=1&h=example.test&p=5181&f=fp&t=${SECRET_MARKER}`;

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
  invite: { ...invite, id, pinLogin: 'dave', pinGithubUserId: 4 },
  secret: SECRET_MARKER,
  url: INVITE_URL,
  hosts: ['example.test'],
  port: 5181,
  fingerprint: 'fp',
  version: 1,
});

describe('workspaceShareSaga', () => {
  const consoleSpies = { warn: vi.spyOn(console, 'warn'), error: vi.spyOn(console, 'error') };
  beforeEach(() => {
    clearInviteLinks();
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
    'workspace.invite.list': { invites: [invite, { ...invite, id: 'inv-2', pinLogin: 'dave' }] },
  });

  it('creates a pinned invite, vaults the one-time link, and re-reads the invites', async () => {
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
    expect(createdLink).toMatchObject({ inviteId: 'inv-2', pinLogin: 'dave' });
    expect(readInviteLink(createdLink!.linkHandle)).toBe(INVITE_URL);
    expect(calls('workspace.invite.list')).toHaveLength(1);
    h.task.cancel();
  });

  // Regression (fe#2440 review P1 / verifier #6): the invite secret must not
  // reach any Redux action, the state, or a console sink.
  it('keeps the invite secret out of every action, the state, and the console', async () => {
    replyByMethod(createdReplies());
    const h = harness(opened());

    h.dispatch(shareInviteCreateRequested({ pinLogin: 'dave' }));
    await settle();

    expect(readInviteLink(h.state().createdLink!.linkHandle)).toContain(SECRET_MARKER);
    expect(JSON.stringify(h.dispatched)).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(h.state())).not.toContain(SECRET_MARKER);
    const consoleText = JSON.stringify([
      ...consoleSpies.warn.mock.calls,
      ...consoleSpies.error.mock.calls,
    ]);
    expect(consoleText).not.toContain(SECRET_MARKER);

    // Closing drops the vaulted url.
    const { linkHandle } = h.state().createdLink!;
    h.dispatch(closeShareDialog());
    await settle();
    expect(readInviteLink(linkHandle)).toBeNull();
    h.task.cancel();
  });

  it('logs only bounded codes when a mutation fails with a message carrying invite material', async () => {
    const leaky = Object.assign(new Error(`invite ${INVITE_URL} rejected`), { rpcCode: -32602 });
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
    expect(sinks).not.toContain(SECRET_MARKER);
    expect(sinks).not.toContain('intent://');
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
    // A's reply was dropped outright: no created action, nothing vaulted.
    expect(h.dispatched.map((a) => (a as { type: string }).type)).not.toContain(
      shareInviteCreated.type,
    );
    expect(JSON.stringify(h.dispatched)).not.toContain(SECRET_MARKER);
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
});
