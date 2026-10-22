import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureInviteAttempt } from '../invite-attempt';

const state = vi.hoisted(() => ({
  parent: null as { webContents: EventEmitter & { id: number; isDestroyed(): boolean } } | null,
  revision: 0,
  enabled: true,
  listeners: new Map<number, () => void>(),
  local: { current: () => true, request: vi.fn() },
}));
vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: () => state.parent } }));
vi.mock('../../../../main/state', () => ({ getMainWindow: () => null }));
vi.mock('../../../backend/main/backend.ipc', () => ({
  captureLocalIdentityConnection: () => state.local,
}));
vi.mock('../../../collaboration-auth/main/collaboration-auth.ipc', () => ({
  captureCollaborationPolicy: () => {
    const revision = state.revision;
    return () => state.enabled && revision === state.revision;
  },
  onCollaborationPolicyChanged: (id: number, listener: () => void) => {
    state.listeners.set(id, listener);
    return () => {
      state.listeners.delete(id);
    };
  },
}));

beforeEach(() => {
  state.revision = 0;
  state.enabled = true;
  state.listeners.clear();
  state.parent = {
    webContents: Object.assign(new EventEmitter(), { id: 19, isDestroyed: () => false }),
  };
  state.local = { current: () => true, request: vi.fn() };
});

describe('original invitation lifetime (controlled main fixtures)', () => {
  it.each(['destroyed', 'render-process-gone', 'did-navigate', 'did-navigate-in-page'])(
    'ends on original renderer %s even after another window gains focus',
    async (event) => {
      const parent = state.parent!;
      const local = state.local;
      const attempt = captureInviteAttempt();
      state.parent = {
        webContents: Object.assign(new EventEmitter(), { id: 20, isDestroyed: () => false }),
      };
      state.local = { current: () => true, request: vi.fn() };
      expect(attempt.parent).toBe(parent);
      expect(attempt.local).toBe(local);
      parent.webContents.emit(event);
      await attempt.cancelled;
      expect(attempt.current()).toBe(false);
      expect(state.listeners.size).toBe(0);
      expect(parent.webContents.eventNames()).toEqual([]);
    },
  );
  it('a flag revision cancels the attempt permanently, including off then on', async () => {
    const attempt = captureInviteAttempt();
    state.enabled = false;
    state.revision++;
    state.listeners.get(19)?.();
    await attempt.cancelled;
    state.enabled = true;
    state.revision++;
    expect(attempt.current()).toBe(false);
    expect(attempt.allowed()).toBe(false);
  });
  it('does not borrow authority from a window that appears after a parentless launch', () => {
    state.parent = null;
    const attempt = captureInviteAttempt();
    state.parent = {
      webContents: Object.assign(new EventEmitter(), { id: 20, isDestroyed: () => false }),
    };
    expect(attempt.current()).toBe(false);
    attempt.release();
  });
});
