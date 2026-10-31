import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';

interface MockTab {
  id: string;
  type: string;
  title: string;
  closable: boolean;
  agentId?: string;
}

interface MockPanel {
  id: string;
  tabs: MockTab[];
  activeTabId: string | null;
}

interface MockSession {
  attentionRequestKind?: string;
  messages?: unknown[];
}

const mockState = {
  tabState: { currentTabId: 'ws-other' as string | null },
  workspace: {
    workspaces: createCollection('id', [{ id: 'ws-1' } as never]),
  },
  hardwareConsole: {
    keyPins: [null, null, null, null, null, null] as (string | null)[],
    excludedWorkspaceIds: [] as string[],
  },
  panelLayout: {
    byWorkspaceId: {} as Record<
      string,
      { focusedPanelId: string | null; panels: Record<string, MockPanel> }
    >,
  },
  agentSessions: { byAgentId: {} as Record<string, MockSession> },
  workspaceAgents: {
    byWorkspaceId: {} as Record<string, { foregroundAgentIds: string[] }>,
  },
};

const dispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string }) => {
      dispatched.push(action);
      return action;
    }),
    createSelector: (selector: (state: typeof mockState) => unknown) => ({
      select: (state: typeof mockState) => selector(state),
    }),
  },
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: vi.fn(() => Promise.resolve()),
  isHudWindowRenderer: () => false,
}));

import { navigateToRoute } from '$lib/utils/navigation.client';
import { focusWorkspaceSlot, handleAgentKeyEvent } from '../key-switch-service';

const focusComposer = vi.fn();

const WS = 'ws-1';

function tab(id: string, type: string, agentId?: string): MockTab {
  return { id, type, title: id, closable: true, agentId };
}

/** Last-assistant message carrying a pending wizard question (LED fixture shape). */
function questionMessage(messageId: string): unknown {
  return {
    id: messageId,
    role: 'assistant',
    contentBlocks: [
      {
        type: 'resource',
        resource: {
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          uri: 'intent-question:1',
          text: JSON.stringify({
            attachmentId: 'tar-1',
            header: 'Choice',
            question: 'Which one?',
            options: [{ label: 'A' }, { label: 'B' }],
          }),
        },
      },
    ],
  };
}

function seedLayout(focusedPanelId: string | null, activeIds: Record<string, string | null>): void {
  mockState.panelLayout.byWorkspaceId[WS] = {
    focusedPanelId,
    panels: {
      'panel-1': {
        id: 'panel-1',
        tabs: [tab('t1', 'note'), tab('t2', 'agent', 'agent-a'), tab('t3', 'agent', 'agent-b')],
        activeTabId: activeIds['panel-1'] ?? null,
      },
      'panel-2': {
        id: 'panel-2',
        tabs: [tab('t4', 'agent', 'agent-c')],
        activeTabId: activeIds['panel-2'] ?? null,
      },
    },
  };
}

function setActiveTabCalls(): { wsId: string; tabId: string; panelId: string }[] {
  return dispatched
    .filter((a) => a.type === 'panelLayout/setActiveTab')
    .map((a) => a.payload as { wsId: string; tabId: string; panelId: string });
}

function focusPanelCalls(): unknown[] {
  return dispatched.filter((a) => a.type === 'panelLayout/focusPanel').map((a) => a.payload);
}

function openWorkspaceTabCalls(): unknown[] {
  return dispatched.filter((a) => a.type === 'tabState/openWorkspaceTab').map((a) => a.payload);
}

beforeEach(() => {
  dispatched.length = 0;
  mockState.tabState.currentTabId = 'ws-other';
  mockState.hardwareConsole.keyPins = [null, null, null, null, null, null];
  mockState.panelLayout.byWorkspaceId = {};
  mockState.agentSessions.byAgentId = {};
  mockState.workspaceAgents.byWorkspaceId = {};
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

describe('focusWorkspaceSlot — first press (workspace not active)', () => {
  it('navigates and lands on the first agent tab with a pending attention request', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = { 'agent-b': { attentionRequestKind: 'discussion' } };

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(openWorkspaceTabCalls()).toEqual([[WS]]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't3', panelId: 'panel-1' }),
    ]);
    expect(focusPanelCalls()).toEqual([]);
  });

  it('prefers the earliest attention tab in tab order', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = {
      'agent-a': { attentionRequestKind: 'blocker' },
      'agent-b': { attentionRequestKind: 'discussion' },
    };

    focusWorkspaceSlot(WS);

    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);
  });

  it('moves panel focus when the attention tab lives in another panel', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = { 'agent-c': { attentionRequestKind: 'blocker' } };

    focusWorkspaceSlot(WS);

    expect(focusPanelCalls()).toEqual([expect.objectContaining({ wsId: WS, panelId: 'panel-2' })]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't4', panelId: 'panel-2' }),
    ]);
  });

  it('targets an agent with a pending wizard question (LED attention parity)', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = {
      'agent-b': { messages: [questionMessage('msg-1')] },
    };

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't3', panelId: 'panel-1' }),
    ]);
  });

  it('keeps the current tab when no agent needs attention', () => {
    seedLayout('panel-1', { 'panel-1': 't2', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(openWorkspaceTabCalls()).toEqual([[WS]]);
    expect(setActiveTabCalls()).toEqual([]);
    expect(focusPanelCalls()).toEqual([]);
  });

  it('activates the first open tab when no attention and no tab is active', () => {
    seedLayout('panel-1', {});

    focusWorkspaceSlot(WS);

    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't1', panelId: 'panel-1' }),
    ]);
  });

  it('opens the first top-level agent when the workspace has no open tabs', () => {
    mockState.workspaceAgents.byWorkspaceId[WS] = {
      foregroundAgentIds: ['agent-a', 'agent-b'],
    };

    focusWorkspaceSlot(WS, { focusComposer });

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatched).toEqual([
      expect.objectContaining({
        type: 'tabState/openWorkspaceTab',
        payload: [WS],
      }),
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: [WS, 'agent-a'],
      }),
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: [WS, { agentId: 'agent-a' }],
      }),
    ]);
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
  });

  it('opens the workspace tab and navigates when the workspace has no open tabs and no agents', () => {
    focusWorkspaceSlot(WS, { focusComposer });

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatched).toEqual([
      expect.objectContaining({ type: 'tabState/openWorkspaceTab', payload: [WS] }),
    ]);
    expect(focusComposer).not.toHaveBeenCalled();
  });
});

describe('focusWorkspaceSlot — subsequent presses (workspace active)', () => {
  beforeEach(() => {
    mockState.tabState.currentTabId = WS;
    window.history.replaceState(null, '', '/workspace/ws-1');
  });

  it('uses the current workspace tab to cycle the focused panel', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);
  });

  it('cycles to the next tab within the focused panel', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(openWorkspaceTabCalls()).toEqual([]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);
    expect(focusPanelCalls()).toEqual([]);
  });

  it('crosses into the next panel after the last tab of the current panel', () => {
    seedLayout('panel-1', { 'panel-1': 't3', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(focusPanelCalls()).toEqual([expect.objectContaining({ wsId: WS, panelId: 'panel-2' })]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't4', panelId: 'panel-2' }),
    ]);
  });

  it('wraps around from the last open tab back to the first', () => {
    seedLayout('panel-2', { 'panel-1': 't3', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(focusPanelCalls()).toEqual([expect.objectContaining({ wsId: WS, panelId: 'panel-1' })]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't1', panelId: 'panel-1' }),
    ]);
  });

  it('starts at the first tab when no tab is currently active', () => {
    seedLayout('panel-1', {});

    focusWorkspaceSlot(WS);

    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't1', panelId: 'panel-1' }),
    ]);
  });

  it('opens the first top-level agent when the workspace has no open tabs', () => {
    mockState.workspaceAgents.byWorkspaceId[WS] = {
      foregroundAgentIds: ['agent-a', 'agent-b'],
    };

    focusWorkspaceSlot(WS, { focusComposer });

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(dispatched).toEqual([
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: [WS, 'agent-a'],
      }),
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: [WS, { agentId: 'agent-a' }],
      }),
    ]);
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
  });

  it('no-ops when the workspace has no open tabs and no agents', () => {
    focusWorkspaceSlot(WS, { focusComposer });

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);
    expect(focusComposer).not.toHaveBeenCalled();
  });
});

describe('focusWorkspaceSlot — workspace tab still current but another route is showing', () => {
  beforeEach(() => {
    // Leaving a workspace for Home or Settings keeps it as the current tab.
    mockState.tabState.currentTabId = WS;
  });

  it.each(['/', '/settings'])(
    'navigates back to the workspace from %s instead of cycling',
    (path) => {
      seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

      focusWorkspaceSlot(WS, { getCurrentPath: () => path });

      expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
      // Lands on the tab the user left, without advancing to the next one.
      expect(setActiveTabCalls()).toEqual([]);
    },
  );

  it('reads the live window route by default (Home at /)', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = { 'agent-b': { attentionRequestKind: 'discussion' } };

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't3', panelId: 'panel-1' }),
    ]);
  });

  it('does not treat a different workspace route sharing the id prefix as active', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

    focusWorkspaceSlot(WS, { getCurrentPath: () => '/workspace/ws-10' });

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(setActiveTabCalls()).toEqual([]);
  });

  it('still cycles tabs when the workspace route is showing', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

    focusWorkspaceSlot(WS, { getCurrentPath: () => '/workspace/ws-1' });

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);
  });
});

describe('focusWorkspaceSlot — second press while the first navigation is in flight', () => {
  it('cycles tabs instead of re-navigating, then re-navigates once the route settled elsewhere', async () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    let settle: () => void = () => {};
    const navigate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    // The route has not committed yet: still on the previous workspace.
    const getCurrentPath = () => '/workspace/ws-other';

    focusWorkspaceSlot(WS, { navigate, getCurrentPath });
    expect(navigate).toHaveBeenCalledTimes(1);
    // The openWorkspaceTab reducer makes ws-1 the current tab synchronously.
    mockState.tabState.currentTabId = WS;
    dispatched.length = 0;

    focusWorkspaceSlot(WS, { navigate, getCurrentPath });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);

    settle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Navigation settled; the user is now on Home, so the press navigates again.
    focusWorkspaceSlot(WS, { navigate, getCurrentPath: () => '/' });
    expect(navigate).toHaveBeenCalledTimes(2);
    settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it.each(['resolves', 'rejects'] as const)(
    'an older navigation to the same workspace that %s does not clear the newest one (A → B → A)',
    async (outcome) => {
      seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
      const attempts: { resolve: () => void; reject: (error: Error) => void }[] = [];
      const navigate = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            attempts.push({ resolve, reject });
          }),
      );
      // No route commits during the sequence.
      const getCurrentPath = () => '/';

      focusWorkspaceSlot(WS, { navigate, getCurrentPath });
      mockState.tabState.currentTabId = WS;
      focusWorkspaceSlot('ws-2', { navigate, getCurrentPath });
      mockState.tabState.currentTabId = 'ws-2';
      focusWorkspaceSlot(WS, { navigate, getCurrentPath });
      mockState.tabState.currentTabId = WS;
      expect(navigate).toHaveBeenCalledTimes(3);

      // The first A navigation settles while the newest A one is still pending.
      if (outcome === 'resolves') attempts[0].resolve();
      else attempts[0].reject(new Error('superseded'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      dispatched.length = 0;

      focusWorkspaceSlot(WS, { navigate, getCurrentPath });

      expect(navigate).toHaveBeenCalledTimes(3);
      expect(setActiveTabCalls()).toEqual([
        expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
      ]);

      for (const attempt of attempts.slice(1)) attempt.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  );
});

describe('handleAgentKeyEvent', () => {
  it('returns null for non-agent keys without touching the store', () => {
    expect(handleAgentKeyEvent('ACT06')).toBeNull();
    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);
  });

  it('focuses the workspace resolved for the pressed key slot', () => {
    // AG00 is the top-left physical key = binding slot 4 (key "5").
    mockState.hardwareConsole.keyPins = [null, null, null, null, 'ws-1', null];
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = { 'agent-b': { attentionRequestKind: 'discussion' } };

    expect(handleAgentKeyEvent('AG00')).toBe('ws-1');

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't3', panelId: 'panel-1' }),
    ]);
  });
});
