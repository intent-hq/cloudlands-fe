import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { store } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { hudTakeoverRequested } from '$store/renderer/slices/hud/hud-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';
import { createNoteId, type Workspace, type WorkspaceTask } from '$shared/types';
import TaskProgressControl from '$lib/components/chat/TaskProgressControl.svelte';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';
import HudTakeoverOverlay from './HudTakeoverOverlay.svelte';
import { HUD_TAKEOVER_BLINK_MS, HUD_TAKEOVER_CLOSE_MS } from './hud-takeover-queue';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

const WS = 'hud-demand';
const OTHER = 'hud-other';
const tasks: WorkspaceTask[] = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Prepare release', status: 'complete' },
  {
    id: 'ship',
    title: 'Ship release',
    status: 'not_started',
    dependsOn: [createNoteId('11111111-1111-4111-8111-111111111111')],
  },
];

// Real overlay, queue/controller, selectors, store, event bridge and read saga.
// Only the daemon transport and browser document visibility are controlled.
describe('displayed HUD task map demand through the real store and wire', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  let stop: () => void;
  let eventId = 0;
  let documentVisible = true;
  const reads = () => backend.requests.filter(({ method }) => method === 'task.list');
  const demand = (id = WS) => store.state.workspaceTasks.byWorkspaceId[id]?.demandIds ?? [];
  const settle = async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(20);
    flushSync();
  };
  async function open(id = WS) {
    store.dispatch(hudTakeoverRequested(id));
    await settle();
  }
  async function close() {
    await fireEvent.click(screen.getByTestId('hud-takeover-dismiss'));
    await settle();
  }
  async function visibility(visible: boolean) {
    documentVisible = visible;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
  }
  function invalidate(id = WS) {
    routeDaemonEventsNotification('events.event', {
      event: {
        id: `hud-demand-${++eventId}`,
        type: 'task:created',
        workspaceId: id,
        data: { noteId: 'ship' },
      },
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    documentVisible = true;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      documentVisible ? 'visible' : 'hidden',
    );
    resetMockBackend();
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    backend.onRequest('task.listAgentLinks', () => ({ links: [], linksByNoteId: {} }));
    backend.onRequest('task.list', () => ({
      tasks,
      stats: { total: 2, completed: 1, inProgress: 0 },
    }));
    dispose = store.init();
    stop = store.runSaga(lifecycleReadSaga);
    for (const id of [WS, OTHER]) {
      store.dispatch(
        setWorkspaceEntity({
          id,
          title: id,
          taskStats: { total: 2, completed: 1, inProgress: 0 },
        } as Workspace),
      );
    }
  });
  afterEach(() => {
    cleanup();
    stop();
    dispose();
    __resetDaemonEventsBridgeForTests();
    resetMockBackend();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the idle overlay quiet and discovers cold task cells and dependency edges on open', async () => {
    render(HudTakeoverOverlay, { nowMs: Date.now() });
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toEqual([]);
    await open();
    expect(reads()).toEqual([{ method: 'task.list', params: { workspaceId: WS } }]);
    expect(screen.getAllByTestId('hud-takeover-cell')).toHaveLength(2);
    expect(screen.getByText('Prepare release')).toBeTruthy();
    expect(screen.getByText('Ship release')).toBeTruthy();
    expect(
      screen.getByTestId('hud-takeover-edges').querySelector('[data-kind="dep"]'),
    ).toBeTruthy();
  });

  it('refreshes an already displayed empty map when its first task arrives without replacing demand', async () => {
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    }));
    render(HudTakeoverOverlay, { nowMs: Date.now() });
    await open();
    expect(reads()).toHaveLength(1);
    expect(screen.queryByTestId('hud-takeover-cell')).toBeNull();
    const token = demand()[0];
    backend.onRequest('task.list', () => ({
      tasks,
      stats: { total: 2, completed: 1, inProgress: 0 },
    }));
    invalidate();
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    await settle();
    expect(reads()).toHaveLength(2);
    expect(screen.getAllByTestId('hud-takeover-cell')).toHaveLength(2);
    expect(demand()).toEqual([token]);
  });

  it('does not acquire while the source card blinks before the map appears', async () => {
    const card = document.createElement('div');
    card.dataset.testid = 'hud-ws-card';
    card.dataset.workspaceId = WS;
    document.body.append(card);
    try {
      render(HudTakeoverOverlay, { nowMs: Date.now() });
      await open();
      expect(screen.queryByTestId('hud-takeover-map')).toBeNull();
      expect(reads()).toEqual([]);
      expect(demand()).toEqual([]);
      await vi.advanceTimersByTimeAsync(HUD_TAKEOVER_BLINK_MS);
      await settle();
      expect(screen.getByTestId('hud-takeover-map')).toBeTruthy();
      expect(reads()).toHaveLength(1);
    } finally {
      card.remove();
    }
  });

  it('releases on dismiss, defers closed invalidations, then refreshes once and reuses clean data', async () => {
    render(HudTakeoverOverlay, { nowMs: Date.now() });
    await open();
    const firstToken = demand()[0];
    expect(demand()).toHaveLength(1);
    await close();
    expect(demand()).toEqual([]);
    invalidate();
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
    await open();
    expect(reads()).toHaveLength(2);
    expect(demand()).toHaveLength(1);
    expect(demand()[0]).not.toBe(firstToken);
    await close();
    await vi.advanceTimersByTimeAsync(HUD_TAKEOVER_CLOSE_MS);
    await open();
    expect(reads()).toHaveLength(2);
  });

  it('defers a cold open in a hidden document and refreshes hidden invalidations once on return', async () => {
    await visibility(false);
    render(HudTakeoverOverlay, { nowMs: Date.now() });
    await open();
    expect(reads()).toEqual([]);
    await visibility(true);
    expect(reads()).toHaveLength(1);
    expect(demand()).toHaveLength(1);
    await visibility(false);
    expect(demand()).toEqual([]);
    invalidate();
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
    await visibility(true);
    expect(reads()).toHaveLength(2);
    await visibility(false);
    await visibility(true);
    expect(reads()).toHaveLength(2);
  });

  it('moves demand on workspace switch, isolates late replies and releases on component unmount', async () => {
    let resolveOld!: (value: unknown) => void;
    backend.onRequest('task.list', (params) =>
      (params as { workspaceId: string }).workspaceId === WS
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : {
            tasks: [{ id: 'other-task', title: 'Other task', status: 'in_progress' }],
            stats: { total: 1, completed: 0, inProgress: 1 },
          },
    );
    const overlay = render(HudTakeoverOverlay, { nowMs: Date.now() });
    await open();
    expect(demand()).toHaveLength(1);
    await open(OTHER);
    await vi.advanceTimersByTimeAsync(HUD_TAKEOVER_CLOSE_MS);
    await settle();
    expect(demand()).toEqual([]);
    expect(demand(OTHER)).toHaveLength(1);
    resolveOld({ tasks, stats: { total: 2, completed: 1, inProgress: 0 } });
    await settle();
    expect(screen.getByText('Other task')).toBeTruthy();
    expect(screen.queryByText('Prepare release')).toBeNull();
    expect(reads()).toEqual([
      { method: 'task.list', params: { workspaceId: WS } },
      { method: 'task.list', params: { workspaceId: OTHER } },
    ]);
    overlay.unmount();
    expect(demand(OTHER)).toEqual([]);
    invalidate();
    invalidate(OTHER);
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
  });

  it('shares one read with a visible chat and preserves that consumer after HUD closes', async () => {
    render(HudTakeoverOverlay, { nowMs: Date.now() });
    await open();
    const chat = render(TaskProgressControl, { workspaceId: WS, tasks: [], embedded: true });
    await settle();
    expect(new Set(demand()).size).toBe(2);
    expect(reads()).toHaveLength(1);
    await close();
    expect(demand()).toHaveLength(1);
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
    chat.unmount();
    expect(demand()).toEqual([]);
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
  });
});
