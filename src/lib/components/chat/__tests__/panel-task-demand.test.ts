import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { faNote } from '$lib/icons/faNote';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import type {
  PanelLayoutNode,
  PanelState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import { store } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { tabTypeRegistry } from '$features/layout/tab-types/registry';
import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
import PanelContainer from '$lib/components/layout/panel-system/PanelContainer.svelte';
import FocusContent from '$lib/components/layout/panel-system/__tests__/mocks/PanelFocusContent.svelte';
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import {
  resetAgentSubscriptionsViewStateForTests,
  setWaitingAgentsExpanded,
} from '../agent-subscriptions-view-state';
import {
  routeDaemonEventsNotification,
  __resetDaemonEventsBridgeForTests,
} from '$features/events/daemon-events-bridge.client';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
// The composer is unrelated to task consumer ownership; retain the real chat,
// tab registration, menus, panel tree, store, event bridge and read saga.
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

const WS = 'panel-task-demand';
const AGENT = 'panel-task-agent';
const CHILD = 'panel-task-worker';
const split: PanelLayoutNode = {
  type: 'split',
  direction: 'horizontal',
  sizes: [50, 50],
  children: [
    {
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [
        { type: 'panel', panelId: 'chat' },
        { type: 'panel', panelId: 'note' },
      ],
    },
    { type: 'panel', panelId: 'other' },
  ],
};
const panels: Record<string, PanelState> = Object.fromEntries(
  ['chat', 'note', 'other'].map((id) => [
    id,
    {
      id,
      tabs: [
        {
          id: `${id}-tab`,
          type: id === 'chat' ? 'agent' : 'note',
          title: id,
          closable: true,
          ...(id === 'chat' ? { agentId: AGENT } : {}),
        },
      ],
      activeTabId: `${id}-tab`,
    },
  ]),
);
const props = (zoomedPanelId: string | null = null, active = true) => ({
  node: split,
  panels,
  panelOrder: ['chat', 'note', 'other'],
  focusedPanelId: 'chat',
  workspaceId: WS,
  layoutId: WS,
  zoomedPanelId,
  active,
  suppressLayoutMotion: true,
});

for (const [type, component] of [
  ['agent', AgentTabType],
  ['note', FocusContent],
] as const) {
  tabTypeRegistry.register({
    type,
    component,
    icon: faNote,
    defaultTitle: type,
    categoryLabel: type,
    defaultWidthTier: 'medium',
  });
}

describe('panel task demand uses displayed menu and zoom visibility', () => {
  let backend: MockBackendHandle;
  let dispose: () => void;
  let stop: () => void;
  let eventId = 0;
  const reads = () => backend.requests.filter(({ method }) => method === 'task.list');
  const demand = () => store.state.workspaceTasks.byWorkspaceId[WS]?.demandIds ?? [];
  const settle = async () => {
    flushSync();
    await vi.advanceTimersByTimeAsync(20);
    flushSync();
  };
  function invalidate() {
    routeDaemonEventsNotification('events.event', {
      event: {
        id: `panel-task-${++eventId}`,
        type: 'task:created',
        workspaceId: WS,
        data: { noteId: 'task-1' },
      },
    });
  }
  function watch() {
    store.dispatch(
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [
          {
            id: 'watch',
            description: 'Worker',
            agentId: AGENT,
            actorIds: [CHILD],
            eventTypes: ['agent:idle'],
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    setWaitingAgentsExpanded(WS, AGENT, true);
  }
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    resetMockBackend();
    resetAgentSubscriptionsViewStateForTests();
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    backend.onRequest('agent.getQueue', () => ({ success: true, queue: [] }));
    backend.onRequest('task.list', () => ({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    }));
    dispose = store.init();
    stop = store.runSaga(lifecycleReadSaga);
    store.dispatch(
      setWorkspaceEntity({
        id: WS,
        title: 'Task workspace',
        path: '/tmp/task-workspace',
        branchName: 'main',
      } as Workspace),
    );
    store.dispatch(
      bulkUpsertSessions([
        {
          id: AGENT,
          workspaceId: WS,
          name: 'Chat',
          status: AgentStatus.Idle,
          messages: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as AgentSession,
      ]),
    );
    store.dispatch(transcriptHydrationSettled(AGENT));
    // A hydrated chat has a current subscription snapshot. This suite starts
    // only task reads; it does not run the separate transcript subscription saga.
    store.dispatch(chatTranscriptSnapshotApplied(AGENT, { truncated: false, totalMessages: 0 }));
  });
  afterEach(() => {
    cleanup();
    stop();
    dispose();
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
    __resetDaemonEventsBridgeForTests();
    resetMockBackend();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a closed menu quiet, discovers empty tasks on open, and refreshes stale tasks once on reopen', async () => {
    render(PanelContainer, props());
    await settle();
    expect(reads()).toEqual([]);
    expect(demand()).toEqual([]);
    const chat = document.querySelector<HTMLElement>('[data-panel-id="chat"]')!;
    const menuButton = within(
      chat.querySelector<HTMLElement>('[data-panel-content-header]')!,
    ).getByTestId('panel-actions-trigger');
    await fireEvent.click(menuButton);
    await settle();
    expect(reads()).toEqual([{ method: 'task.list', params: { workspaceId: WS } }]);
    expect(store.state.workspaceTasks.byWorkspaceId[WS].initialized).toBe(true);
    await fireEvent.click(menuButton);
    await settle();
    expect(demand()).toEqual([]);
    backend.onRequest('task.list', () => ({
      tasks: [{ id: 'task-1', title: 'Discovered task', status: 'in_progress', specLinked: true }],
      stats: { total: 1, completed: 0, inProgress: 1 },
    }));
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(1);
    await fireEvent.click(menuButton);
    await settle();
    expect(reads()).toEqual(
      Array.from({ length: 2 }, () => ({ method: 'task.list', params: { workspaceId: WS } })),
    );
    await fireEvent.keyDown(screen.getByTestId('task-progress-trigger'), { key: 'ArrowRight' });
    await settle();
    expect(screen.getByText('Discovered task')).toBeTruthy();
    await fireEvent.keyDown(screen.getByTestId('task-progress-popover'), { key: 'Escape' });
    await settle();
    await fireEvent.click(menuButton);
    await settle();
    expect(demand()).toEqual([]);
    await fireEvent.click(menuButton);
    await settle();
    expect(reads()).toHaveLength(2);
  });

  it.each(['other', 'note'])(
    'releases a chat hidden by zooming %s and refreshes once when zoom returns',
    async (target) => {
      watch();
      const view = render(PanelContainer, props());
      await settle();
      expect(reads()).toHaveLength(1);
      expect(demand().length).toBeGreaterThan(0);
      await view.rerender(props(target));
      await settle();
      expect(demand()).toEqual([]);
      invalidate();
      await vi.advanceTimersByTimeAsync(1100);
      expect(reads()).toHaveLength(1);
      await view.rerender(props('chat'));
      await settle();
      expect(reads()).toHaveLength(2);
      await view.rerender(props());
      await settle();
      expect(reads()).toHaveLength(2);
    },
  );

  it('preserves another visible consumer while a nested chat is zoom-hidden', async () => {
    watch();
    const view = render(PanelContainer, props());
    const independent = render(AgentSubscriptions, {
      workspaceId: WS,
      agentId: AGENT,
      isActive: true,
    });
    await settle();
    expect(demand().length).toBeGreaterThan(1);
    expect(reads()).toHaveLength(1);
    await view.rerender(props('other'));
    await settle();
    expect(demand()).toHaveLength(1);
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
    independent.unmount();
    expect(demand()).toEqual([]);
    invalidate();
    await vi.advanceTimersByTimeAsync(1100);
    expect(reads()).toHaveLength(2);
  });
  it('blurs a zoom-hidden editor before making it inert, then cancels eviction on return', async () => {
    const view = render(PanelContainer, props());
    await settle();
    const editor = document.querySelector<HTMLElement>(
      '.tab-content-wrapper[data-tab-id="note-tab"]',
    )!;
    const control = within(editor).getByRole('textbox');
    control.focus();
    expect(document.activeElement).toBe(control);
    let inertAtBlur: boolean | null = null;
    control.addEventListener('blur', () => {
      inertAtBlur = editor.inert;
    });
    await view.rerender(props('other'));
    await settle();
    expect(document.activeElement).not.toBe(control);
    expect(inertAtBlur).toBe(false);
    expect(editor.inert).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    await view.rerender(props());
    await settle();
    expect(editor.inert).toBe(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(editor.isConnected).toBe(true);
    await view.rerender(props('other'));
    await vi.advanceTimersByTimeAsync(30000);
    await settle();
    expect(editor.isConnected).toBe(false);
  });
});
