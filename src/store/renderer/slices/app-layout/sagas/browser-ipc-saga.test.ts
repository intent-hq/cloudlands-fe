import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(() => Promise.resolve()),
  storage: new Map<string, unknown>(),
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron, invoke: mocks.invoke }));
// Transitive imports of the panel-layout saga (pulled in for on-demand
// hydration, monorepo#2789) that must not drag in the real app store / IPC;
// storage is Map-backed because the global localStorage mock always
// returns null.
vi.mock('$features/layout/panel-layout-adapter', () => ({
  clearPanelLayoutAdapter: vi.fn(),
}));
vi.mock('$features/layout/panel-layout-history.client', () => ({
  loadPanelLayoutHistory: vi.fn(),
  savePanelLayoutHistory: vi.fn(),
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  // A stored Error simulates a throwing restore path (hydration failure).
  getLocalStorageJSON: function* (key: string) {
    const value = mocks.storage.get(key);
    if (value instanceof Error) throw value;
    return value;
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.storage.set(key, value);
  },
  removeLocalStorageItem: function* (key: string) {
    mocks.storage.delete(key);
  },
}));

import { PANEL_LAYOUT_STORAGE_KEY_PREFIX } from '../../panel-layout/panel-layout-types';
import { panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import { browserIpcSaga } from './browser-ipc-saga';

const NOW = new Date('2026-07-31T00:00:00.000Z').getTime();
const TAB = (url: string) => ({
  type: 'browser',
  title: 'Browser',
  browserUrl: url,
  closable: true,
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const persistedLayout = (tabs: unknown[]) => ({
  root: { type: 'panel', panelId: 'panel-1' },
  panels: { 'panel-1': { id: 'panel-1', tabs, activeTabId: null } },
  focusedPanelId: 'panel-1',
  canvasWidth: null,
  canvasWidthSource: null,
});

describe('browserIpcSaga', () => {
  let handlers: Record<string, (payload: unknown) => void>;
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;
  let state: any;

  const start = (dispatch: (action: unknown) => void = vi.fn()) =>
    runSaga({ dispatch, getState: () => state }, browserIpcSaga);
  const emit = async (payload: unknown, channel = 'browser:open-tab') => {
    handlers[channel](payload);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    handlers = {};
    on = vi.fn((channel: string, next: (payload: unknown) => void) => {
      handlers[channel] = next;
      return `${channel}-listener`;
    });
    offById = vi.fn();
    window.electronAPI = { ...window.electronAPI, on, offById };
    state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [] } };
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    mocks.storage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prevents duplicate starts, then removes and reinstalls the listeners around cancellation', async () => {
    const first = start();
    const duplicate = start();
    await duplicate.toPromise();
    expect(on.mock.calls).toEqual([
      ['browser:open-tab', handlers['browser:open-tab']],
      ['browser:close-tab', handlers['browser:close-tab']],
      ['browser:focus-tab', handlers['browser:focus-tab']],
      ['browser:show-tab', handlers['browser:show-tab']],
      ['browser:list-tabs-request', handlers['browser:list-tabs-request']],
      ['browser:tab-navigated', handlers['browser:tab-navigated']],
      ['browser:tab-owner-changed', handlers['browser:tab-owner-changed']],
    ]);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual([
      ['browser:open-tab', 'browser:open-tab-listener'],
      ['browser:close-tab', 'browser:close-tab-listener'],
      ['browser:focus-tab', 'browser:focus-tab-listener'],
      ['browser:show-tab', 'browser:show-tab-listener'],
      ['browser:list-tabs-request', 'browser:list-tabs-request-listener'],
      ['browser:tab-navigated', 'browser:tab-navigated-listener'],
      ['browser:tab-owner-changed', 'browser:tab-owner-changed-listener'],
    ]);

    const restarted = start();
    expect(on).toHaveBeenCalledTimes(14);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('maps every position and replacement branch exactly without leaking wire-only fields', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({ url: 'https://one.test', workspaceId: 'ws-1' });
    await emit({ url: 'https://two.test', position: 'adjacent', workspaceId: 'ws-1' });
    await emit({ url: 'https://three.test', position: 'same', workspaceId: 'ws-1' });
    await emit({ url: 'https://four.test', workspaceId: 'ws-2', workspace_id: 'wire-only' });
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: { tabs: [{ id: 'note-1', type: 'note' }] },
              two: { tabs: [{ id: 'browser-1', type: 'browser' }] },
            },
          },
        },
      },
    };
    await emit({ url: 'https://replace.test', position: 'replace', workspaceId: 'ws-1' });
    state = {
      panelLayout: {
        byWorkspaceId: { 'ws-1': { panels: { one: { tabs: [{ id: 'note-1', type: 'note' }] } } } },
      },
    };
    await emit({ url: 'https://new.test', position: 'replace', workspaceId: 'ws-1' });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://one.test'),
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://two.test'),
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://three.test'),
          panelId: undefined,
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-2',
          tab: TAB('https://four.test'),
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-1', 'https://replace.test', null],
      },
      {
        type: 'panelLayout/setActiveTab',
        payload: { wsId: 'ws-1', tabId: 'browser-1', panelId: undefined, timestamp: NOW },
      },
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://new.test'),
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // Main binds the ownership-checked adoption target into the payload as
  // replaceTabId; the replace must land on exactly that tab, and an agent
  // open must never fall back to replacing an unchecked tab (TOCTOU,
  // monorepo#2857).
  it('replaces exactly the main-bound replaceTabId, not whichever browser tab is first now', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  { id: 'browser-new-first', type: 'browser' },
                  { id: 'browser-checked', type: 'browser' },
                ],
              },
            },
          },
        },
      },
    };

    await emit({
      url: 'https://bound.test',
      position: 'replace',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      replaceTabId: 'browser-checked',
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-checked', 'https://bound.test', null],
      },
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'browser-checked', 'agent-1'],
      },
      {
        type: 'panelLayout/setActiveTab',
        payload: { wsId: 'ws-1', tabId: 'browser-checked' },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // Hidden-replace (monorepo#2857): an AGENT replace bound to a hidden
  // (user-closed) owned tab navigates it in place and leaves it hidden; an
  // unowned (user) open never adopts a hidden tab — that would look like a
  // no-op and retarget an agent-owned tab.
  it('an agent replace bound to a hidden owned tab navigates it in place and keeps it hidden', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [] } },
            hiddenTabs: createCollection('id', [
              { id: 'browser-hidden', type: 'browser', ownerAgentId: 'agent-1' },
            ]),
          },
        },
      },
    };

    await emit({
      url: 'https://hidden.test',
      position: 'replace',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      replaceTabId: 'browser-hidden',
    });

    // Navigate + ownership only — no setActiveTab/openTab: the tab stays
    // hidden (the user's close is respected).
    expect(actions).toMatchObject([
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-hidden', 'https://hidden.test', null],
      },
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'browser-hidden', 'agent-1'],
      },
    ]);
    expect(actions.map((a: any) => a.type)).not.toContain('panelLayout/setActiveTab');
    task.cancel();
    await task.toPromise();
  });

  it('an unowned replace bound to a hidden tab never adopts it — opens a visible tab instead', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [] } },
            hiddenTabs: createCollection('id', [
              { id: 'browser-hidden', type: 'browser', ownerAgentId: 'agent-1' },
            ]),
          },
        },
      },
    };

    await emit({
      url: 'https://user.test',
      position: 'replace',
      workspaceId: 'ws-1',
      replaceTabId: 'browser-hidden',
    });

    expect(actions.map((a: any) => a.type)).toEqual([
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('an agent replace whose bound target is gone opens a new tab instead of adopting an unchecked one', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'browser-other', type: 'browser' }] } } },
        },
      },
    };

    await emit({
      url: 'https://gone.test',
      position: 'replace',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      replaceTabId: 'browser-closed',
    });
    // Legacy/agent payload without replaceTabId: same rule — main never
    // checked 'browser-other', so no adoption.
    await emit({
      url: 'https://legacy.test',
      position: 'replace',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
    });

    // The rightmost-column saga owns the fixed-column reconciliation and
    // workspace-not-displayed reveal drop (monorepo#3045).
    expect(actions.map((a: any) => a.type)).toEqual([
      'panelLayout/openTabInRightmostColumnRequested',
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    expect(actions[0]).toMatchObject({
      payload: {
        wsId: 'ws-1',
        agentDriven: true,
        tab: { ...TAB('https://gone.test'), ownerAgentId: 'agent-1' },
      },
    });
    expect(actions[1]).toMatchObject({
      payload: {
        wsId: 'ws-1',
        agentDriven: true,
        tab: { ...TAB('https://legacy.test'), ownerAgentId: 'agent-1' },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('uses the main-provided tabId and forwards allowDuplicate on every position branch (monorepo#2541)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://one.test',
      workspaceId: 'ws-1',
      tabId: 'tab-main-1',
      allowDuplicate: true,
    });
    await emit({
      url: 'https://two.test',
      position: 'same',
      workspaceId: 'ws-1',
      tabId: 'tab-main-2',
      allowDuplicate: true,
    });
    await emit({
      url: 'https://three.test',
      position: 'replace',
      workspaceId: 'ws-1',
      tabId: 'tab-main-3',
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://one.test'),
          force: false,
          allowDuplicate: true,
          newTabId: 'tab-main-1',
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://two.test'),
          panelId: undefined,
          newTabId: 'tab-main-2',
          force: false,
          timestamp: NOW,
          allowDuplicate: true,
        },
      },
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://three.test'),
          newTabId: 'tab-main-3',
          force: false,
          timestamp: NOW,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('opens an explicit browser request without creating legacy panel pin state', async () => {
    const actions: any[] = [];
    const task = start((action: any) => {
      actions.push(action);
      if (action.type === 'panelLayout/openTabInRightmostColumnRequested') {
        state.panelLayout.byWorkspaceId['ws-1'] = {
          panels: {},
          pendingPanelReveal: {
            panelId: 'panel-resolved',
            tabId: 'browser-reused',
            requestId: action.payload.newTabId,
          },
        };
      }
    });

    await emit({ url: 'https://pinned.test', workspaceId: 'ws-1', tabId: 'request-1', pin: true });

    expect(actions.map((action) => action.type)).toEqual([
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the payload requestedUrl on the opened tab (monorepo#2789)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'http://127.0.0.1:52345/',
      workspaceId: 'ws-1',
      requestedUrl: 'http://daemon.localhost:3000/',
    });
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } } },
        },
      },
    };
    await emit({
      url: 'http://127.0.0.1:52345/',
      position: 'replace',
      workspaceId: 'ws-1',
      requestedUrl: 'http://daemon.localhost:3000/',
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: {
            ...TAB('http://127.0.0.1:52345/'),
            browserRequestedUrl: 'http://daemon.localhost:3000/',
          },
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-1', 'http://127.0.0.1:52345/', 'http://daemon.localhost:3000/'],
      },
      {
        type: 'panelLayout/setActiveTab',
        payload: { wsId: 'ws-1', tabId: 'browser-1', panelId: undefined, timestamp: NOW },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not pin when the pending reveal belongs to another request', async () => {
    const actions: any[] = [];
    const task = start((action: any) => {
      actions.push(action);
      if (action.type === 'panelLayout/openTabInRightmostColumnRequested') {
        state.panelLayout.byWorkspaceId['ws-1'] = {
          panels: {},
          pendingPanelReveal: {
            panelId: 'panel-other',
            tabId: 'browser-other',
            requestId: 'another-request',
          },
        };
      }
    });

    await emit({ url: 'https://stale.test', workspaceId: 'ws-1', tabId: 'request-1', pin: true });

    expect(actions.map((action) => action.type)).toEqual([
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists a main-driven navigation with its requested URL via browser:tab-navigated (monorepo#2789)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } } },
        },
      },
    };

    // Rewritten navigation: records the requested URL.
    await emit(
      {
        tabId: 'browser-1',
        workspaceId: 'ws-1',
        url: 'http://127.0.0.1:52345/page',
        requestedUrl: 'http://daemon.localhost:3000/page',
      },
      'browser:tab-navigated',
    );
    // Non-rewritten navigation: clears any stored requested URL.
    await emit(
      { tabId: 'browser-1', workspaceId: 'ws-1', url: 'https://example.test/' },
      'browser:tab-navigated',
    );

    expect(actions).toEqual([
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: [
          'ws-1',
          'browser-1',
          'http://127.0.0.1:52345/page',
          'http://daemon.localhost:3000/page',
        ],
      },
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-1', 'https://example.test/', null],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:tab-navigated with bad payloads or for un-hosted workspaces', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    await emit({}, 'browser:tab-navigated');
    await emit({ tabId: 'browser-1', workspaceId: 'ws-1' }, 'browser:tab-navigated');
    await emit({ tabId: 7, workspaceId: 'ws-1', url: 'https://x.test/' }, 'browser:tab-navigated');
    await emit(
      { tabId: 'browser-1', url: 'https://x.test/' }, // no workspaceId
      'browser:tab-navigated',
    );
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  // Owner-changed events carry the emulated viewport (claims + resizes,
  // monorepo#2857 §5.9): a well-formed size rides along, a malformed one is
  // dropped rather than poisoning the tab record.
  it('persists ownership with the emulated size via browser:tab-owner-changed', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } } },
        },
      },
    };

    await emit(
      {
        tabId: 'browser-1',
        workspaceId: 'ws-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 390, height: 844 },
      },
      'browser:tab-owner-changed',
    );
    // Legacy payload without a size, and a malformed size: owner only.
    await emit(
      { tabId: 'browser-1', workspaceId: 'ws-1', ownerAgentId: 'agent-1' },
      'browser:tab-owner-changed',
    );
    await emit(
      {
        tabId: 'browser-1',
        workspaceId: 'ws-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: -1, height: 'x' },
      },
      'browser:tab-owner-changed',
    );

    expect(actions).toEqual([
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'browser-1', 'agent-1', { width: 390, height: 844 }],
      },
      { type: 'panelLayout/setTabOwnerAgent', payload: ['ws-1', 'browser-1', 'agent-1'] },
      { type: 'panelLayout/setTabOwnerAgent', payload: ['ws-1', 'browser-1', 'agent-1'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists an owned fit viewport in one store action', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } } },
        },
      },
    };

    await emit(
      {
        tabId: 'browser-1',
        workspaceId: 'ws-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 1280, height: 800 },
        viewport: { mode: 'fit' },
      },
      'browser:tab-owner-changed',
    );

    expect(actions).toEqual([
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: [
          'ws-1',
          'browser-1',
          'agent-1',
          { width: 1280, height: 800 },
          undefined,
          { mode: 'fit' },
        ],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('opens an agent tab with the payload emulatedSize persisted on the tab (§5.9)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://sized.test',
      position: 'same',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      emulatedSize: { width: 390, height: 844 },
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: {
            ...TAB('https://sized.test'),
            ownerAgentId: 'agent-1',
            emulatedSize: { width: 390, height: 844 },
          },
        },
      },
      { type: 'panelLayout/consumePanelReveal' },
      { type: 'panelLayout/consumePendingFocus' },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // Only owned tabs are emulated (§5.9): a size arriving without an owner is
  // dropped at the boundary rather than recorded on a native tab.
  it('drops emulatedSize on unowned opens', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://native.test',
      position: 'same',
      workspaceId: 'ws-1',
      emulatedSize: { width: 390, height: 844 },
    });

    expect(actions).toHaveLength(1);
    const open = actions[0] as { type: string; payload: { tab: Record<string, unknown> } };
    expect(open.type).toBe('panelLayout/openTab');
    expect(open.payload.tab).not.toHaveProperty('ownerAgentId');
    expect(open.payload.tab).not.toHaveProperty('emulatedSize');
    task.cancel();
    await task.toPromise();
  });

  // Agent opens are hidden by default (monorepo#3045): visible: false creates
  // the tab straight into hiddenTabs — no panel mount, no focus/active-tab
  // change — on every position branch.
  it('creates an agent open with visible: false directly in hiddenTabs', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://hidden.test',
      workspaceId: 'ws-1',
      tabId: 'tab-main-1',
      ownerAgentId: 'agent-1',
      emulatedSize: { width: 390, height: 844 },
      visible: false,
    });
    await emit({
      url: 'https://hidden-same.test',
      position: 'same',
      workspaceId: 'ws-1',
      tabId: 'tab-main-2',
      ownerAgentId: 'agent-1',
      visible: false,
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openHiddenTab',
        payload: {
          wsId: 'ws-1',
          tab: {
            ...TAB('https://hidden.test'),
            ownerAgentId: 'agent-1',
            emulatedSize: { width: 390, height: 844 },
          },
          newTabId: 'tab-main-1',
        },
      },
      {
        type: 'panelLayout/openHiddenTab',
        payload: {
          wsId: 'ws-1',
          tab: { ...TAB('https://hidden-same.test'), ownerAgentId: 'agent-1' },
          newTabId: 'tab-main-2',
        },
      },
    ]);
    expect(actions).toHaveLength(2);
    task.cancel();
    await task.toPromise();
  });

  it('visible: true keeps the panel-mounted open for agent tabs', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://visible.test',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      visible: true,
    });

    // The rightmost-column saga activates the tab without moving focus and
    // drops the queued reveal when the workspace is not displayed
    // (monorepo#3045); it is not running in this harness.
    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          agentDriven: true,
          tab: { ...TAB('https://visible.test'), ownerAgentId: 'agent-1' },
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // Only owned tabs can be hidden: hide-on-close and the sidebar restore
  // affordance are ownership-scoped, so an unowned hidden tab would be
  // unrestorable. visible: false without an owner opens visibly.
  it('ignores visible: false on unowned opens', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({ url: 'https://user.test', workspaceId: 'ws-1', visible: false });

    expect(actions).toMatchObject([
      { type: 'panelLayout/openTabInRightmostColumnRequested', payload: { wsId: 'ws-1' } },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // A hidden (default) agent replace adopting a visible tab updates it in
  // place but never activates it or moves focus — and never hides it
  // (monorepo#3045).
  it('a hidden agent replace adopting a visible tab skips activation and focus', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } },
            hiddenTabs: createCollection('id'),
          },
        },
      },
    };

    await emit({
      url: 'https://adopt.test',
      position: 'replace',
      workspaceId: 'ws-1',
      replaceTabId: 'browser-1',
      ownerAgentId: 'agent-1',
      visible: false,
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-1', 'https://adopt.test', null],
      },
      { type: 'panelLayout/setTabOwnerAgent', payload: ['ws-1', 'browser-1', 'agent-1'] },
    ]);
    expect(actions).toHaveLength(2);
    task.cancel();
    await task.toPromise();
  });

  it('a hidden agent replace with no adoption target opens into hiddenTabs', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://replace-new.test',
      position: 'replace',
      workspaceId: 'ws-1',
      tabId: 'tab-main-3',
      ownerAgentId: 'agent-1',
      visible: false,
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openHiddenTab',
        payload: {
          wsId: 'ws-1',
          tab: { ...TAB('https://replace-new.test'), ownerAgentId: 'agent-1' },
          newTabId: 'tab-main-3',
        },
      },
    ]);
    expect(actions).toHaveLength(1);
    task.cancel();
    await task.toPromise();
  });

  it('no-ops for invalid payloads and when neither workspace source is available', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    await emit({});
    await emit({ url: 7 });
    state = { panelLayout: { byWorkspaceId: {} } };
    await emit({ url: 'https://ignored.test' });
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('closes a closable browser tab via browser:close-tab (monorepo#1931)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-2': {
            panels: {
              one: { tabs: [{ id: 'browser-1', type: 'browser', closable: true }] },
            },
          },
        },
      },
    };

    await emit({ tabId: 'browser-1', workspaceId: 'ws-2' }, 'browser:close-tab');

    expect(actions).toEqual([
      {
        type: 'panelLayout/closeTab',
        // Main-driven closes destroy (never hide) the tab (monorepo#2857).
        payload: {
          wsId: 'ws-2',
          tabId: 'browser-1',
          panelId: undefined,
          timestamp: NOW,
          destroy: true,
          preservePanel: false,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('rejects browser:close-tab when workspaceId is missing', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: { tabs: [{ id: 'browser-1', type: 'browser', closable: true }] },
            },
          },
        },
      },
    };

    await emit({ tabId: 'browser-1' }, 'browser:close-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:close-tab for missing, non-browser, or non-closable tabs and bad payloads', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  { id: 'note-1', type: 'note', closable: true },
                  { id: 'browser-pinned', type: 'browser', closable: false },
                ],
              },
            },
          },
        },
      },
    };

    await emit({}, 'browser:close-tab');
    await emit({ tabId: 7 }, 'browser:close-tab');
    await emit({ tabId: 'missing-tab' }, 'browser:close-tab');
    await emit({ tabId: 'note-1' }, 'browser:close-tab');
    await emit({ tabId: 'browser-pinned' }, 'browser:close-tab');
    state = { panelLayout: { byWorkspaceId: {} } };
    await emit({ tabId: 'browser-1' }, 'browser:close-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches focusBrowserTabRequested for the payload workspace, active or not (monorepo#2756)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit(
      { tabId: 'browser-1', workspaceId: 'ws-background', pin: true },
      'browser:focus-tab',
    );

    expect(actions).toEqual([
      {
        type: 'appLayout/focusBrowserTabRequested',
        payload: ['ws-background', 'browser-1', true, true],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:focus-tab without workspaceId or tabId', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({}, 'browser:focus-tab');
    await emit({ tabId: 'browser-1' }, 'browser:focus-tab');
    await emit({ tabId: 7, workspaceId: 'ws-1' }, 'browser:focus-tab');
    await emit({ workspaceId: 'ws-1' }, 'browser:focus-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  // showTab (monorepo#3045): activate an owned tab in a visible panel — a
  // hidden tab is revealed, a visible-but-inactive one is brought to the
  // front. focus: false (default) activates without moving panel focus;
  // focus: true activates and focuses; already-displayed tabs are idempotent.
  it('browser:show-tab restores a hidden tab without focus by default', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [] } },
            hiddenTabs: createCollection('id', [
              { id: 'browser-hidden', type: 'browser', ownerAgentId: 'agent-1' },
            ]),
          },
        },
      },
    };

    await emit({ tabId: 'browser-hidden', workspaceId: 'ws-1' }, 'browser:show-tab');

    // The no-focus reveal still activates the tab in a visible panel
    // (monorepo#3112), so its queued reveal/scroll markers are dropped when
    // this window is not displaying the workspace (jsdom's route is `/`).
    expect(actions).toEqual([
      {
        type: 'panelLayout/restoreHiddenTab',
        payload: {
          wsId: 'ws-1',
          tabId: 'browser-hidden',
          timestamp: NOW,
          focus: false,
        },
      },
      { type: 'panelLayout/consumePanelReveal', payload: ['ws-1', 'browser-hidden'] },
      { type: 'panelLayout/consumePendingFocus', payload: ['ws-1', 'browser-hidden'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('browser:show-tab with focus: true restores and activates the hidden tab', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [] } },
            hiddenTabs: createCollection('id', [
              { id: 'browser-hidden', type: 'browser', ownerAgentId: 'agent-1' },
            ]),
          },
        },
      },
    };

    await emit({ tabId: 'browser-hidden', workspaceId: 'ws-1', focus: true }, 'browser:show-tab');

    // The focusing reveal is followed by the workspace-not-displayed drop
    // (monorepo#3045): jsdom's route is `/`, not this workspace, so the
    // mount/activation state stands but the queued UI reveal is consumed.
    expect(actions).toEqual([
      {
        type: 'panelLayout/restoreHiddenTab',
        payload: {
          wsId: 'ws-1',
          tabId: 'browser-hidden',
          timestamp: NOW,
          focus: true,
        },
      },
      { type: 'panelLayout/consumePanelReveal', payload: ['ws-1', 'browser-hidden'] },
      { type: 'panelLayout/consumePendingFocus', payload: ['ws-1', 'browser-hidden'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('browser:show-tab on a visible-but-inactive tab activates it in place without focus', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  { id: 'note-1', type: 'note' },
                  { id: 'browser-1', type: 'browser' },
                ],
                activeTabId: 'note-1',
              },
            },
            hiddenTabs: createCollection('id'),
          },
        },
      },
    };

    await emit({ tabId: 'browser-1', workspaceId: 'ws-1' }, 'browser:show-tab');

    // Focus-preserving in-place activation (monorepo#3045), followed by the
    // workspace-not-displayed drop of its queued reveal (jsdom's route is `/`).
    expect(actions).toEqual([
      {
        type: 'panelLayout/activateVisibleTab',
        payload: { wsId: 'ws-1', tabId: 'browser-1', timestamp: NOW },
      },
      { type: 'panelLayout/consumePanelReveal', payload: ['ws-1', 'browser-1'] },
      { type: 'panelLayout/consumePendingFocus', payload: ['ws-1', 'browser-1'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('browser:show-tab on an already-visible tab with focus: true takes the focus path', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [{ id: 'browser-1', type: 'browser' }] } },
            hiddenTabs: createCollection('id'),
          },
        },
      },
    };

    await emit({ tabId: 'browser-1', workspaceId: 'ws-1', focus: true }, 'browser:show-tab');
    expect(actions).toEqual([
      {
        type: 'appLayout/focusBrowserTabRequested',
        payload: ['ws-1', 'browser-1', undefined, true],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:show-tab without workspaceId or tabId', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({}, 'browser:show-tab');
    await emit({ tabId: 'browser-1' }, 'browser:show-tab');
    await emit({ tabId: 7, workspaceId: 'ws-1' }, 'browser:show-tab');
    await emit({ workspaceId: 'ws-1' }, 'browser:show-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('marks hidden owned tabs with hidden: true in list replies (monorepo#3045)', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  {
                    id: 'browser-visible',
                    type: 'browser',
                    browserUrl: 'http://a/',
                    title: 'A',
                    ownerAgentId: 'agent-1',
                  },
                ],
                activeTabId: null,
              },
            },
            hiddenTabs: createCollection('id', [
              {
                id: 'browser-hidden',
                type: 'browser',
                browserUrl: 'http://b/',
                title: 'B',
                ownerAgentId: 'agent-1',
              },
            ]),
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-1', requestId: 'req-hidden' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-hidden',
      tabs: [
        {
          tabId: 'browser-visible',
          url: 'http://a/',
          title: 'A',
          closable: true,
          ownerAgentId: 'agent-1',
        },
        {
          tabId: 'browser-hidden',
          url: 'http://b/',
          title: 'B',
          closable: true,
          ownerAgentId: 'agent-1',
          hidden: true,
        },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  // A panel-mounted tab is `active` only when it is its panel's active tab
  // (the only one the panel can paint); a mounted-but-inactive tab and a hidden tab
  // carry no marker, even when a stale activeTabId still names the hidden one.
  it("marks each panel's active tab with active: true in list replies", async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  { id: 'browser-active', type: 'browser', browserUrl: 'http://a/', title: 'A' },
                  { id: 'browser-inactive', type: 'browser', browserUrl: 'http://b/', title: 'B' },
                ],
                activeTabId: 'browser-active',
              },
              two: {
                tabs: [
                  { id: 'note-1', type: 'note', title: 'Note' },
                  { id: 'browser-behind', type: 'browser', browserUrl: 'http://c/', title: 'C' },
                ],
                activeTabId: 'note-1',
              },
              three: { tabs: [], activeTabId: 'browser-hidden' },
            },
            hiddenTabs: createCollection('id', [
              {
                id: 'browser-hidden',
                type: 'browser',
                browserUrl: 'http://d/',
                title: 'D',
                ownerAgentId: 'agent-1',
              },
            ]),
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-1', requestId: 'req-active' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-active',
      tabs: [
        {
          tabId: 'browser-active',
          url: 'http://a/',
          title: 'A',
          closable: true,
          active: true,
        },
        { tabId: 'browser-inactive', url: 'http://b/', title: 'B', closable: true },
        { tabId: 'browser-behind', url: 'http://c/', title: 'C', closable: true },
        {
          tabId: 'browser-hidden',
          url: 'http://d/',
          title: 'D',
          closable: true,
          ownerAgentId: 'agent-1',
          hidden: true,
        },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  it("answers a list-tabs request with the requested workspace's browser tabs even when backgrounded", async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-active': {
            panels: {
              one: { tabs: [{ id: 'browser-x', type: 'browser', browserUrl: 'http://x/' }] },
            },
          },
          'ws-background': {
            panels: {
              one: {
                tabs: [
                  { id: 'note-1', type: 'note' },
                  {
                    id: 'browser-1',
                    type: 'browser',
                    browserUrl: 'http://a/',
                    title: 'A',
                    closable: true,
                  },
                  {
                    id: 'browser-pinned',
                    type: 'browser',
                    browserUrl: 'http://b/',
                    closable: false,
                  },
                ],
              },
            },
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-background', requestId: 'req-1' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-1',
      tabs: [
        { tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true },
        { tabId: 'browser-pinned', url: 'http://b/', title: 'Browser', closable: false },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  it('never resolves a requestId for a workspace this window does not host (monorepo#2602)', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-here': {
            panels: {
              one: { tabs: [{ id: 'browser-1', type: 'browser', browserUrl: 'http://a/' }] },
            },
          },
        },
      },
      tabState: { workspaceStacks: [['ws-here']] },
    };

    await emit({ workspaceId: 'ws-elsewhere', requestId: 'req-2' }, 'browser:list-tabs-request');
    await emit({ requestId: 'req-3' }, 'browser:list-tabs-request');

    expect(mocks.invoke).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('answers concurrent list requests for two workspaces with their own tabs and requestIds', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-a': {
            panels: {
              one: {
                tabs: [{ id: 'tab-a', type: 'browser', browserUrl: 'http://a/', title: 'A' }],
              },
            },
          },
          'ws-b': {
            panels: {
              one: {
                tabs: [{ id: 'tab-b', type: 'browser', browserUrl: 'http://b/', title: 'B' }],
              },
            },
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-a', requestId: 'req-a' }, 'browser:list-tabs-request');
    await emit({ workspaceId: 'ws-b', requestId: 'req-b' }, 'browser:list-tabs-request');

    expect(mocks.invoke.mock.calls).toEqual([
      [
        'browser:list-tabs-response',
        {
          requestId: 'req-a',
          tabs: [{ tabId: 'tab-a', url: 'http://a/', title: 'A', closable: true }],
        },
      ],
      [
        'browser:list-tabs-response',
        {
          requestId: 'req-b',
          tabs: [{ tabId: 'tab-b', url: 'http://b/', title: 'B', closable: true }],
        },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('replies with an empty tab list for a held workspace with no browser tabs', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'note-1', type: 'note' }] } } },
        },
      },
    };

    await emit({ workspaceId: 'ws-1', requestId: 'req-4' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-4',
      tabs: [],
    });
    task.cancel();
    await task.toPromise();
  });

  // Persisted emulated size (monorepo#2857): the size rides with the owner in
  // both directions — list replies carry it to main for rehydration, and
  // owner-changed events (claim / resizeTab) persist it on the layout tab.
  it('includes persisted sizing state of owned tabs in list replies (valid sizes only)', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  {
                    id: 'tab-owned',
                    type: 'browser',
                    browserUrl: 'http://a/',
                    title: 'A',
                    ownerAgentId: 'agent-1',
                    emulatedSize: { width: 390, height: 844 },
                    viewport: { mode: 'custom', width: 390, height: 844 },
                  },
                  {
                    id: 'tab-bad-size',
                    type: 'browser',
                    browserUrl: 'http://b/',
                    title: 'B',
                    ownerAgentId: 'agent-2',
                    emulatedSize: { width: -1, height: 0 },
                  },
                  { id: 'tab-user', type: 'browser', browserUrl: 'http://c/', title: 'C' },
                ],
              },
            },
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-1', requestId: 'req-size' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-size',
      tabs: [
        {
          tabId: 'tab-owned',
          url: 'http://a/',
          title: 'A',
          closable: true,
          ownerAgentId: 'agent-1',
          emulatedSize: { width: 390, height: 844 },
          viewport: { mode: 'custom', width: 390, height: 844 },
        },
        {
          tabId: 'tab-bad-size',
          url: 'http://b/',
          title: 'B',
          closable: true,
          ownerAgentId: 'agent-2',
        },
        { tabId: 'tab-user', url: 'http://c/', title: 'C', closable: true },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  it('persists the emulatedSize from a tab-owner-changed event (and tolerates its absence)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [{ id: 'tab-1', type: 'browser' }] } },
          },
        },
      },
    };

    await emit(
      {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 390, height: 844 },
      },
      'browser:tab-owner-changed',
    );
    // Legacy/size-less payload: owner only.
    await emit(
      { workspaceId: 'ws-1', tabId: 'tab-1', ownerAgentId: 'agent-1' },
      'browser:tab-owner-changed',
    );

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'tab-1', 'agent-1', { width: 390, height: 844 }],
      },
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'tab-1', 'agent-1'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the emulatedSize from an agent open payload on the new tab', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://sized.test',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      emulatedSize: { width: 1024, height: 768 },
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          agentDriven: true,
          tab: {
            ...TAB('https://sized.test'),
            ownerAgentId: 'agent-1',
            emulatedSize: { width: 1024, height: 768 },
          },
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  // monorepo#3438: the owner's display name rides the open and owner-changed
  // payloads and persists with the tab so the sidebar can label the owner
  // group without an agent-store lookup.
  it('persists the ownerAgentName from an agent open payload on the new tab', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://named.test',
      workspaceId: 'ws-1',
      ownerAgentId: 'agent-1',
      ownerAgentName: 'Docs Writer',
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          agentDriven: true,
          tab: {
            ...TAB('https://named.test'),
            ownerAgentId: 'agent-1',
            ownerAgentName: 'Docs Writer',
          },
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores an ownerAgentName without an ownerAgentId on an open payload', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://user.test',
      workspaceId: 'ws-1',
      ownerAgentName: 'Docs Writer',
    });

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: { wsId: 'ws-1', tab: TAB('https://user.test') },
      },
    ]);
    expect((actions[0] as any).payload.tab.ownerAgentName).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('persists the ownerAgentName from a tab-owner-changed event', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: { one: { tabs: [{ id: 'tab-1', type: 'browser' }] } },
          },
        },
      },
    };

    await emit(
      {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        ownerAgentId: 'agent-1',
        ownerAgentName: 'Docs Writer',
        emulatedSize: { width: 390, height: 844 },
      },
      'browser:tab-owner-changed',
    );

    expect(actions).toMatchObject([
      {
        type: 'panelLayout/setTabOwnerAgent',
        payload: ['ws-1', 'tab-1', 'agent-1', { width: 390, height: 844 }, 'Docs Writer'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  describe('background hydration for hosted-but-unvisited workspaces (monorepo#2789)', () => {
    const startWithReducer = () => {
      const actions: unknown[] = [];
      const task = start((action: any) => {
        actions.push(action);
        state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
      });
      return { actions, task };
    };
    const hostedState = (wsId: string) => {
      state = {
        panelLayout: { byWorkspaceId: {} },
        tabState: { workspaceStacks: [[wsId]] },
        workspaceAgents: { byWorkspaceId: {} },
      };
    };
    const seedStorage = (wsId: string, tabs: unknown[]) => {
      mocks.storage.set(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, persistedLayout(tabs));
    };

    it('hydrates the persisted layout and answers listTabs for a hosted-but-unvisited workspace', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-1');
      seedStorage('ws-hyd-1', [
        { id: 'note-1', type: 'note', title: 'Note' },
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ workspaceId: 'ws-hyd-1', requestId: 'req-h1' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-h1',
        tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true }],
      });
      task.cancel();
      await task.toPromise();
    });

    it('answers with an empty-but-truthful tab list when nothing is stored for a hosted workspace', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-2');

      await emit({ workspaceId: 'ws-hyd-2', requestId: 'req-h2' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-h2',
        tabs: [],
      });
      task.cancel();
      await task.toPromise();
    });

    it('hydrates at most once for back-to-back requests (idempotent double-hydration)', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-3');
      seedStorage('ws-hyd-3', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ workspaceId: 'ws-hyd-3', requestId: 'req-h3a' }, 'browser:list-tabs-request');
      await emit({ workspaceId: 'ws-hyd-3', requestId: 'req-h3b' }, 'browser:list-tabs-request');

      const restores = actions.filter(
        (action: any) => action.type === 'panelLayout/initializeLayout',
      );
      expect(restores).toHaveLength(1);
      expect(mocks.invoke.mock.calls.map(([, payload]: any[]) => payload)).toEqual([
        {
          requestId: 'req-h3a',
          tabs: [
            { tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true, active: true },
          ],
        },
        {
          requestId: 'req-h3b',
          tabs: [
            { tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true, active: true },
          ],
        },
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('closes a tab in a hosted-but-unvisited workspace after hydrating it', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-4');
      seedStorage('ws-hyd-4', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-4' }, 'browser:close-tab');

      expect(actions).toContainEqual(
        expect.objectContaining({
          type: 'panelLayout/closeTab',
          payload: expect.objectContaining({ wsId: 'ws-hyd-4', tabId: 'browser-1' }),
        }),
      );
      task.cancel();
      await task.toPromise();
    });

    it('stays silent for a workspace neither hydrated nor in this window tab bar', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-5');

      await emit({ workspaceId: 'ws-not-here', requestId: 'req-h5' }, 'browser:list-tabs-request');

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
      task.cancel();
      await task.toPromise();
    });

    it('answers listTabs for the ROUTED workspace even with no layout entry and no tab-strip membership', async () => {
      // Main routes LIST_TABS_REQUEST at windows by the routed workspace
      // (windowWorkspaceIds) as well as the tab strip, so a window routed to
      // /workspace/{id} must answer even when the workspace is missing from
      // workspaceStacks — staying silent times the request out as "renderer
      // did not respond" (monorepo#2789 live regression in v2.64.0).
      const { task } = startWithReducer();
      state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [] } };
      seedStorage('ws-routed-1', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);
      window.history.pushState({}, '', '/workspace/ws-routed-1');
      try {
        await emit(
          { workspaceId: 'ws-routed-1', requestId: 'req-r1' },
          'browser:list-tabs-request',
        );
      } finally {
        window.history.pushState({}, '', '/');
      }

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-r1',
        tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true, active: true }],
      });
      task.cancel();
      await task.toPromise();
    });

    it('stays silent when the route is /workspace/new and the workspace is otherwise unhosted', async () => {
      const { actions, task } = startWithReducer();
      state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [] } };
      window.history.pushState({}, '', '/workspace/new');
      try {
        await emit({ workspaceId: 'new', requestId: 'req-r2' }, 'browser:list-tabs-request');
      } finally {
        window.history.pushState({}, '', '/');
      }

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
      task.cancel();
      await task.toPromise();
    });

    it('stays silent for a non-routed workspace when the window is routed to a different one', async () => {
      const { actions, task } = startWithReducer();
      state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [] } };
      window.history.pushState({}, '', '/workspace/ws-routed-other');
      try {
        await emit(
          { workspaceId: 'ws-not-here', requestId: 'req-r3' },
          'browser:list-tabs-request',
        );
      } finally {
        window.history.pushState({}, '', '/');
      }

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
      task.cancel();
      await task.toPromise();
    });

    it('opens with position "replace" against the hydrated layout, reusing the persisted browser tab', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-6');
      seedStorage('ws-hyd-6', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit(
        { url: 'http://replaced/', position: 'replace', workspaceId: 'ws-hyd-6' },
        'browser:open-tab',
      );

      expect(actions).toContainEqual({
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-hyd-6', 'browser-1', 'http://replaced/', null],
      });
      expect(actions).toContainEqual(
        expect.objectContaining({
          type: 'panelLayout/setActiveTab',
          payload: expect.objectContaining({ wsId: 'ws-hyd-6', tabId: 'browser-1' }),
        }),
      );
      expect(actions.map((action: any) => action.type)).not.toContain('panelLayout/openTab');
      task.cancel();
      await task.toPromise();
    });

    it('replies with a truthful hydration error instead of tabs when the restore throws', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-err-1');
      mocks.storage.set(
        `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-1`,
        new Error('storage exploded'),
      );

      await emit({ workspaceId: 'ws-hyd-err-1', requestId: 'req-e1' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-e1',
        error: 'layout hydration failed: storage exploded',
      });
      task.cancel();
      await task.toPromise();
    });

    it('retries hydration on the next request after a failed one instead of answering empty', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-err-2');
      const key = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-2`;
      mocks.storage.set(key, new Error('storage exploded'));

      await emit(
        { workspaceId: 'ws-hyd-err-2', requestId: 'req-e2a' },
        'browser:list-tabs-request',
      );
      mocks.storage.set(
        key,
        persistedLayout([
          { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
        ]),
      );
      await emit(
        { workspaceId: 'ws-hyd-err-2', requestId: 'req-e2b' },
        'browser:list-tabs-request',
      );

      expect(mocks.invoke.mock.calls.map(([, payload]: any[]) => payload)).toEqual([
        { requestId: 'req-e2a', error: 'layout hydration failed: storage exploded' },
        {
          requestId: 'req-e2b',
          tabs: [
            { tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true, active: true },
          ],
        },
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('survives a hydration failure in close/focus handlers and keeps servicing requests', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-err-3');
      mocks.storage.set(
        `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-3`,
        new Error('storage exploded'),
      );

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-err-3' }, 'browser:close-tab');
      expect(actions.map((action: any) => action.type)).not.toContain('panelLayout/closeTab');

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-err-3' }, 'browser:focus-tab');
      expect(actions).toContainEqual({
        type: 'appLayout/focusBrowserTabRequested',
        payload: ['ws-hyd-err-3', 'browser-1', undefined, true],
      });

      // The saga is still alive: a later healthy request is answered.
      state = {
        ...state,
        tabState: { workspaceStacks: [['ws-hyd-err-3', 'ws-hyd-ok']] },
      };
      seedStorage('ws-hyd-ok', [
        { id: 'browser-2', type: 'browser', title: 'B', browserUrl: 'http://b/', closable: true },
      ]);
      await emit({ workspaceId: 'ws-hyd-ok', requestId: 'req-ok' }, 'browser:list-tabs-request');
      expect(mocks.invoke).toHaveBeenCalledWith('browser:list-tabs-response', {
        requestId: 'req-ok',
        tabs: [{ tabId: 'browser-2', url: 'http://b/', title: 'B', closable: true, active: true }],
      });
      task.cancel();
      await task.toPromise();
    });
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await start().toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
