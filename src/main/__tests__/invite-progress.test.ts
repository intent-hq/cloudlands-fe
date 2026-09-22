/**
 * Unit tests for the renderer-rendered invite progress dialog
 * (src/main/invite-progress.ts): show → ack → (update)* → cancel? → dismiss
 * over the `invite-progress:*` channels, with every unavailable-renderer path
 * yielding an inert handle (no native fallback for progress).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import type {
  InviteProgressDismissPayload,
  InviteProgressShowPayload,
  InviteProgressUpdatePayload,
} from '../../shared/ipc/invite-progress';
import { resetInviteProgressStateForTests, showInviteProgress } from '../invite-progress';

const logLines: string[] = [];
vi.mock('../../shared/logger', () => ({
  Logger: class {
    debug(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    info(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    warn(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    error(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
  },
}));

const PAYLOAD: InviteProgressShowPayload = {
  requestId: 'req-1',
  phase: 'connecting',
  hostLabel: '192.168.1.10',
};

function makeWindow() {
  const send = vi.fn();
  const goneListeners = new Map<string, (() => void)[]>();
  const webContents = {
    isDestroyed: () => false,
    send,
    once: vi.fn((event: string, listener: () => void) => {
      const existing = goneListeners.get(event) ?? [];
      existing.push(listener);
      goneListeners.set(event, existing);
    }),
    removeListener: vi.fn(),
  };
  const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
  const emitRendererGone = (event: string) => {
    for (const listener of goneListeners.get(event) ?? []) listener();
  };
  return { window, send, emitRendererGone };
}

async function getHandlers() {
  const { ipcMain } = await import('electron');
  const handle = vi.mocked(ipcMain.handle);
  const find = (channel: string) =>
    handle.mock.calls.filter(([c]) => c === channel).at(-1)?.[1] as (
      event: unknown,
      data: unknown,
    ) => Promise<unknown>;
  return { ack: find('invite-progress:ack'), response: find('invite-progress:response') };
}

function sentOn<T>(send: ReturnType<typeof vi.fn>, channel: string): T[] {
  return send.mock.calls.filter(([c]) => c === channel).map(([, payload]) => payload as T);
}

function dismissesSent(send: ReturnType<typeof vi.fn>): InviteProgressDismissPayload[] {
  return sentOn(send, 'invite-progress:dismiss');
}

/** Whether `cancelled` has settled by the next microtask turn. */
async function settled(cancelled: Promise<void>): Promise<boolean> {
  let done = false;
  void cancelled.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

beforeEach(() => {
  resetInviteProgressStateForTests();
  logLines.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showInviteProgress — renderer round-trip', () => {
  it('sends the show payload and stays live after the ack', async () => {
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });

    expect(send).toHaveBeenCalledWith('invite-progress:show', PAYLOAD);
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });

    expect(await settled(handle.cancelled)).toBe(false);
    expect(dismissesSent(send)).toEqual([]);
  });

  it('resolves cancelled on a cancel response for the active request', async () => {
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });

    await expect(handle.cancelled).resolves.toBeUndefined();
    // Cancel does not close the dialog by itself; the caller dismisses.
    expect(dismissesSent(send)).toEqual([]);
    handle.dismiss();
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId }]);
  });

  it('forwards update with the request id kept', async () => {
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });

    handle.update('opening', { workspaceTitle: 'Shared workspace' });
    expect(sentOn<InviteProgressUpdatePayload>(send, 'invite-progress:update')).toEqual([
      { requestId: PAYLOAD.requestId, phase: 'opening', workspaceTitle: 'Shared workspace' },
    ]);
  });

  it('dismiss is idempotent and silences later updates and cancels', async () => {
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });

    handle.dismiss();
    handle.dismiss();
    handle.update('opening');
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId }]);
    expect(sentOn(send, 'invite-progress:update')).toEqual([]);

    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    expect(await settled(handle.cancelled)).toBe(false);
  });

  it('ignores ack/response for a stale requestId', async () => {
    const { window } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: 'stale' });
    await handlers.response({}, { requestId: 'stale', action: 'cancel' });
    expect(await settled(handle.cancelled)).toBe(false);

    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await expect(handle.cancelled).resolves.toBeUndefined();
  });

  it('a newer request supersedes the previous one for the handlers', async () => {
    const { window } = makeWindow();
    const first = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const second = showInviteProgress(
      { ...PAYLOAD, requestId: 'req-2' },
      { getParentWindow: () => window },
    );
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    expect(await settled(first.cancelled)).toBe(false);
    await handlers.response({}, { requestId: 'req-2', action: 'cancel' });
    await expect(second.cancelled).resolves.toBeUndefined();
  });
});

describe('showInviteProgress — no renderer, no progress UI', () => {
  it('treats a valid response as an implicit ack when the ack invoke was lost', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(handle.cancelled).resolves.toBeUndefined();
    expect(dismissesSent(send)).toEqual([]);
  });

  it('dismisses and turns inert when the renderer never acks', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dismissesSent(send)).toEqual([{ requestId: PAYLOAD.requestId }]);

    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    expect(await settled(handle.cancelled)).toBe(false);
    handle.update('opening');
    handle.dismiss();
    expect(sentOn(send, 'invite-progress:update')).toEqual([]);
    expect(dismissesSent(send)).toHaveLength(1);
  });

  it('does not fire the ack timeout once acked', async () => {
    vi.useFakeTimers();
    const { window, send } = makeWindow();
    showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dismissesSent(send)).toEqual([]);
  });

  it('returns an inert handle when no window exists', async () => {
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => null });
    expect(await settled(handle.cancelled)).toBe(false);
    handle.update('opening');
    handle.dismiss();
    expect(logLines.some((line) => line.includes('No window for the invite progress'))).toBe(true);
  });

  it('returns an inert handle when webContents.send throws', async () => {
    const marker = 'untrusted-send-failure-marker';
    const { window, send } = makeWindow();
    send.mockImplementation(() => {
      throw new Error(`render frame disposed ${marker}`);
    });
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    expect(await settled(handle.cancelled)).toBe(false);
    handle.dismiss();
    expect(send).toHaveBeenCalledTimes(1);
    expect(logLines.some((line) => line.includes('renderer-send-failed'))).toBe(true);
    expect(logLines.some((line) => line.includes(marker))).toBe(false);
  });

  it('turns inert when the renderer dies before acking', async () => {
    const { window, send, emitRendererGone } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    emitRendererGone('destroyed');
    const handlers = await getHandlers();
    await handlers.response({}, { requestId: PAYLOAD.requestId, action: 'cancel' });
    expect(await settled(handle.cancelled)).toBe(false);
    handle.dismiss();
    expect(dismissesSent(send)).toEqual([]);
  });

  it('turns inert when the renderer navigates away after acking', async () => {
    const { window, send, emitRendererGone } = makeWindow();
    const handle = showInviteProgress(PAYLOAD, { getParentWindow: () => window });
    const handlers = await getHandlers();
    await handlers.ack({}, { requestId: PAYLOAD.requestId });
    emitRendererGone('did-navigate');
    handle.update('opening');
    handle.dismiss();
    expect(sentOn(send, 'invite-progress:update')).toEqual([]);
    expect(dismissesSent(send)).toEqual([]);
  });
});
