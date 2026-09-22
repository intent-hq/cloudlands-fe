import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockInvoke, registerMockIpcHandler } from '$shared/ipc-mock-router';
import { store } from '$store/renderer/configured-store';
import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
import { markAgentAsViewed } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { selectSubscriptionSnapshotStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';

const liveRequest = vi.hoisted(() =>
  vi.fn<(method: string) => Promise<unknown>>(async () => 'live'),
);
const transport = vi.hoisted(() => ({
  request: liveRequest,
  isAvailable: () => false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onNotification: vi.fn(),
  onReconnected: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: () => transport,
}));
vi.mock('$features/notes/notes-write-service', () => ({
  settleNoteContent: vi.fn(async () => {}),
}));
vi.mock('./content-sharing.preview-fixtures', () => ({
  SHARING_AGENT_ID: 'preview-agent',
  SHARING_NOTE_ID: 'preview-note',
  SHARING_WORKSPACE_ID: 'preview-workspace',
  sharingNote: { content: 'Sample note', updatedAt: '2026-09-21T12:00:00.000Z' },
}));

import { isolateSharingPreview } from './content-sharing.preview-isolation';

const disposers: Array<() => Promise<void>> = [];
let disposeStore: () => void;
beforeAll(() => {
  disposeStore = store.init();
});
afterAll(() => disposeStore());
afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose();
  disposers.length = 0;
  vi.clearAllMocks();
});

describe('content sharing preview isolation', () => {
  it('refreshes the fixture snapshot after viewing the chat and stops refreshing after disposal', async () => {
    const snapshotStatus = () =>
      selectSubscriptionSnapshotStatus.select(store.state, 'preview-workspace', 'preview-agent');
    const dispose = isolateSharingPreview('ready', vi.fn());
    disposers.push(dispose);
    await vi.waitFor(() => expect(snapshotStatus()).toBe('ready'));
    store.dispatch(markAgentAsViewed('preview-agent'));
    expect(snapshotStatus()).toBe('loading');
    await vi.waitFor(() => expect(snapshotStatus()).toBe('ready'));
    await dispose();
    store.dispatch(markAgentAsViewed('preview-agent'));
    await Promise.resolve();
    expect(snapshotStatus()).toBe('loading');
  });

  it('resolves header-menu workspace paths locally and restores the prior IPC handler', async () => {
    const original = vi.fn(() => ({ success: false }));
    registerMockIpcHandler('workspace:get', original);
    const dispose = isolateSharingPreview('ready', vi.fn());
    disposers.push(dispose);
    expect(await mockInvoke('workspace:get', { id: 'preview-workspace' })).toEqual({
      success: true,
      data: {
        id: 'preview-workspace',
        title: 'Content sharing · fictional workspace',
        status: 'active',
        worktreePath: '/preview/content-sharing',
      },
    });
    expect(original).not.toHaveBeenCalled();
    expect(liveRequest).not.toHaveBeenCalled();
    await dispose();
    expect(await mockInvoke('workspace:get', { id: 'preview-workspace' })).toEqual({
      success: false,
    });
    expect(original).toHaveBeenCalledOnce();
  });

  it('mirrors catalog theme changes for Monaco and restores the app theme on disposal', async () => {
    store.dispatch(setThemeName('dark'));
    document.documentElement.classList.remove('dark');
    const dispose = isolateSharingPreview('note-raw', vi.fn());
    disposers.push(dispose);
    expect(selectIsDarkTheme.select(store.state)).toBe(false);
    document.documentElement.classList.add('dark');
    await Promise.resolve();
    expect(selectIsDarkTheme.select(store.state)).toBe(true);
    document.documentElement.classList.remove('dark');
    await dispose();
    expect(selectIsDarkTheme.select(store.state)).toBe(true);
  });

  it('captures both clipboard routes and restores the original IPC handler and browser descriptor', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    registerMockIpcHandler('system:write-clipboard', () => ({ original: true }));
    const capture = vi.fn();
    const dispose = isolateSharingPreview('ready', capture);
    disposers.push(dispose);
    await navigator.clipboard.writeText('browser text');
    await mockInvoke('system:write-clipboard', { text: 'native text' });
    expect(capture.mock.calls).toEqual([
      [{ kind: 'clipboard', text: 'browser text' }],
      [{ kind: 'clipboard', text: 'native text' }],
    ]);
    await dispose();
    expect(Object.getOwnPropertyDescriptor(navigator, 'clipboard')).toEqual(originalDescriptor);
    expect(await mockInvoke('system:write-clipboard', { text: 'after' })).toEqual({
      original: true,
    });
    expect(transport.request).toBe(liveRequest);
  });

  it('blocks unknown backend methods rather than falling through to production', async () => {
    const capture = vi.fn();
    disposers.push(isolateSharingPreview('ready', capture));
    await expect(transport.request('workspace.delete')).rejects.toThrow(
      'Preview does not implement',
    );
    expect(liveRequest).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith({
      kind: 'blocked',
      text: 'Preview blocked backend method: workspace.delete',
    });
  });

  it('rejects both clipboard routes for the deterministic failure state', async () => {
    const capture = vi.fn();
    disposers.push(isolateSharingPreview('clipboard-failure', capture));
    await expect(navigator.clipboard.writeText('test')).rejects.toThrow('Simulated preview');
    await expect(mockInvoke('system:write-clipboard', { text: 'test' })).rejects.toThrow(
      'Simulated preview',
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it('keeps the newer scene isolated while a prior scene tears down', async () => {
    const first = isolateSharingPreview('ready', vi.fn());
    const second = isolateSharingPreview('clipboard-failure', vi.fn());
    disposers.push(first, second);
    await first();
    await expect(navigator.clipboard.writeText('test')).rejects.toThrow('Simulated preview');
    await expect(transport.request('workspace.delete')).rejects.toThrow();
    expect(liveRequest).not.toHaveBeenCalled();
    await second();
    expect(transport.request).toBe(liveRequest);
  });
});
