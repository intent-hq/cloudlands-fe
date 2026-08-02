import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';

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
  workspace: {
    activeWorkspaceId: 'ws-other' as string | null,
    workspaces: createCollection('id', [{ id: 'ws-1' } as never]),
  },
  hardwareConsole: { keyPins: [null, null, null, null, null, null] as (string | null)[] },
  panelLayout: {
    byWorkspaceId: {} as Record<
      string,
      { focusedPanelId: string | null; panels: Record<string, MockPanel> }
    >,
  },
  agentSessions: { byAgentId: {} as Record<string, MockSession> },
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
  },
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: vi.fn(() => Promise.resolve()),
}));

import { navigateToRoute } from '$lib/utils/navigation.client';
import { focusWorkspaceSlot, handleAgentKeyEvent } from '../key-switch-service';

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

beforeEach(() => {
  dispatched.length = 0;
  mockState.workspace.activeWorkspaceId = 'ws-other';
  mockState.hardwareConsole.keyPins = [null, null, null, null, null, null];
  mockState.panelLayout.byWorkspaceId = {};
  mockState.agentSessions.byAgentId = {};
  vi.clearAllMocks();
});

describe('focusWorkspaceSlot — first press (workspace not active)', () => {
  it('navigates and lands on the first agent tab with a pending attention request', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });
    mockState.agentSessions.byAgentId = { 'agent-b': { attentionRequestKind: 'discussion' } };

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
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

    expect(focusPanelCalls()).toEqual([[WS, 'panel-2']]);
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

  it('only navigates when the workspace has no open tabs', () => {
    focusWorkspaceSlot(WS);

    expect(navigateToRoute).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatched).toHaveLength(0);
  });
});

describe('focusWorkspaceSlot — subsequent presses (workspace active)', () => {
  beforeEach(() => {
    mockState.workspace.activeWorkspaceId = WS;
  });

  it('cycles to the next tab within the focused panel', () => {
    seedLayout('panel-1', { 'panel-1': 't1', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't2', panelId: 'panel-1' }),
    ]);
    expect(focusPanelCalls()).toEqual([]);
  });

  it('crosses into the next panel after the last tab of the current panel', () => {
    seedLayout('panel-1', { 'panel-1': 't3', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(focusPanelCalls()).toEqual([[WS, 'panel-2']]);
    expect(setActiveTabCalls()).toEqual([
      expect.objectContaining({ wsId: WS, tabId: 't4', panelId: 'panel-2' }),
    ]);
  });

  it('wraps around from the last open tab back to the first', () => {
    seedLayout('panel-2', { 'panel-1': 't3', 'panel-2': 't4' });

    focusWorkspaceSlot(WS);

    expect(focusPanelCalls()).toEqual([[WS, 'panel-1']]);
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

  it('no-ops when the workspace has no open tabs', () => {
    focusWorkspaceSlot(WS);

    expect(navigateToRoute).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);
  });
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
