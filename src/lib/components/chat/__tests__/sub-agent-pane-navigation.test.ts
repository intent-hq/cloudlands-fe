/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
import {
  clearPanelLayout,
  closeActiveTab,
  initializeLayout,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types';
import AgentCard from '../AgentCard.svelte';
import ToolDetails from '../ToolDetails.svelte';
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import {
  setSubscriptionSnapshot,
  deleteSubscriptionUI,
} from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';

const workspaceId = 'sub-agent-pane-navigation';
const agentId = 'navigation-child';
let stop: () => void;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  appStore.init();
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AgentId(agentId),
        workspaceId: WorkspaceId(workspaceId),
        backendSessionId: null,
        name: 'Child agent',
        status: AgentStatus.RuntimeIdle,
        messages: [],
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      },
    ]),
  );
  const tabs = ['A', 'B', 'C'].map((id) => ({
    id,
    type: 'note' as const,
    title: id,
    noteId: id,
    closable: true,
  }));
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'source' },
          { type: 'panel', panelId: 'other' },
        ],
      },
      panels: {
        source: { id: 'source', tabs, activeTabId: 'B' },
        other: {
          id: 'other',
          tabs: [{ ...tabs[0], id: 'other-tab', noteId: 'other' }],
          activeTabId: 'other-tab',
        },
      },
      focusedPanelId: 'other',
    }),
  );
  stop = appStore.runSaga(appLayoutNavigationSaga);
});

afterEach(() => {
  stop();
  cleanup();
  appStore.dispatch(clearPanelLayout(workspaceId));
  appStore.dispatch(removeSession(agentId));
  appStore.dispatch(deleteSubscriptionUI(workspaceId, 'parent'));
  vi.unstubAllGlobals();
});

describe('sub-agent links in chat panes', () => {
  it.each([
    'card-avatar',
    'agent-list',
    'agent-message',
    'watched',
    'finished',
    'context-menu',
  ] as const)(
    'inserts a child after the clicked pane and returns on close via %s',
    async (entry) => {
      const watched = entry === 'watched' || entry === 'finished';
      if (watched) {
        appStore.dispatch(openWorkspaceTab(workspaceId));
        appStore.dispatch(
          setSubscriptionSnapshot(workspaceId, 'parent', {
            subscriptions: [
              {
                id: 'watch',
                agentId: 'parent',
                actorIds: [agentId],
                eventTypes: ['agent:idle'],
                createdAt: '2026-10-02T00:00:00Z',
                description: 'Watch child',
              },
            ],
            delegationGroups: [],
            agentStatuses: { [agentId]: entry === 'finished' ? 'completed' : 'idle' },
            waitingState: entry === 'finished' ? 'completed' : 'waiting',
          }),
        );
      }
      const view = watched
        ? render(AgentSubscriptions, { workspaceId, agentId: 'parent' })
        : entry === 'card-avatar' || entry === 'context-menu'
          ? render(AgentCard, { agentId, hidePreview: true })
          : render(ToolDetails, {
              workspaceId,
              input: {},
              result: { success: true },
              parsedResult:
                entry === 'agent-list'
                  ? {
                      type: 'agent-list',
                      agents: [{ agentId, name: 'Child agent', status: 'idle' }],
                    }
                  : {
                      type: 'agent-message',
                      toAgentId: agentId,
                      messageContent: 'Check the implementation',
                    },
            });
      view.container.setAttribute('data-panel-id', 'source');
      const avatar = view.container.querySelector('[data-agent-avatar]')!;
      const target = avatar.querySelector('path') ?? avatar;
      if (entry === 'context-menu') {
        await fireEvent.contextMenu(target);
        await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open', exact: true }));
      } else {
        await fireEvent.click(target);
      }
      const layout = () => appStore.state.panelLayout.byWorkspaceId[workspaceId];
      expect(layout().panels.source.tabs.map((tab) => tab.noteId ?? tab.agentId)).toEqual([
        'A',
        'B',
        agentId,
        'C',
      ]);
      expect(layout().focusedPanelId).toBe('source');
      expect(layout().panels.source.activeTabId).toBe(layout().panels.source.tabs[2].id);
      appStore.dispatch(closeActiveTab(workspaceId, 'source'));
      expect(layout().panels.source.activeTabId).toBe('B');
      expect(layout().panels.source.tabs.map((tab) => tab.id)).toEqual(['A', 'B', 'C']);
      if (entry === 'context-menu') return;
      await fireEvent.click(target, { ctrlKey: true });
      expect(layout().panels.source.tabs.map((tab) => tab.id)).toEqual(['A', 'B', 'C']);
      expect(layout().panels.other.tabs.map((tab) => tab.noteId ?? tab.agentId)).toEqual([
        'other',
        agentId,
      ]);
      expect(layout().focusedPanelId).toBe('other');
    },
  );
});
