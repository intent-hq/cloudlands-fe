import { describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import {
  ACTION_KEY_REGISTRY,
  getActionKeyDefinition,
  type ActionKeyContext,
  type ActionKeyState,
} from '../action-key-registry';
import { ACTION_KEY_ACTION_IDS } from '../action-mapping';

function makeWorkspace(id: string): Workspace {
  return { id } as unknown as Workspace;
}

function makeSession(
  agentId: string,
  inProgress: boolean,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: agentId,
    status: inProgress ? 'active' : 'Completed',
    isProcessing: inProgress,
    messages: [],
    ...overrides,
  } as never;
}

interface StateOptions {
  activeWorkspaceId?: string | null;
  workspaces?: string[];
  agentsByWorkspace?: Record<string, { ids: string[]; activeAgentId?: string | null }>;
  inProgressAgentIds?: string[];
  sessionOverrides?: Record<string, Record<string, unknown>>;
  unreadAgentIds?: string[];
  selectedTabs?: Record<string, string[]>;
}

function makeState(options: StateOptions = {}): ActionKeyState {
  const workspaceIds = options.workspaces ?? ['ws-1'];
  const byWorkspaceId: ActionKeyState['workspaceAgents']['byWorkspaceId'] = {};
  const byAgentId: ActionKeyState['agentSessions']['byAgentId'] = {};
  for (const [wsId, entry] of Object.entries(options.agentsByWorkspace ?? {})) {
    byWorkspaceId[wsId] = {
      foregroundAgentIds: entry.ids,
      activeAgentId: entry.activeAgentId ?? null,
    };
    for (const agentId of entry.ids) {
      byAgentId[agentId] = makeSession(
        agentId,
        (options.inProgressAgentIds ?? []).includes(agentId),
        options.sessionOverrides?.[agentId] ?? {},
      );
    }
  }
  return {
    workspace: {
      activeWorkspaceId:
        options.activeWorkspaceId === undefined ? 'ws-1' : options.activeWorkspaceId,
      workspaces: createCollection('id', workspaceIds.map(makeWorkspace)),
    },
    workspaceAgents: { byWorkspaceId },
    agentSessions: { byAgentId },
    unreadTracking: { unreadAgentIds: options.unreadAgentIds ?? [] },
    sidebarNav: {
      multiSelectTabOrder: [],
      multiSelectSelectedTabIdsByWorkspaceId: options.selectedTabs ?? {},
    },
  };
}

function makeContext(state: ActionKeyState) {
  const dispatch = vi.fn();
  const navigate = vi.fn(() => Promise.resolve());
  const focusComposer = vi.fn();
  const context: ActionKeyContext = { state, dispatch, navigate, focusComposer };
  return { context, dispatch, navigate, focusComposer };
}

describe('ACTION_KEY_REGISTRY', () => {
  it('contains exactly the v1 actions in spec order', () => {
    expect(ACTION_KEY_REGISTRY.map((entry) => entry.id)).toEqual([...ACTION_KEY_ACTION_IDS]);
  });

  it('every entry exposes a label and an icon', () => {
    for (const entry of ACTION_KEY_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.icon).toBeTruthy();
    }
  });
});

describe('availability', () => {
  it('workspace-scoped actions are unavailable without an active workspace', () => {
    const { context } = makeContext(makeState({ activeWorkspaceId: null }));
    for (const id of [
      'cycle-workspace-agents',
      'stop-agent',
      'see-spec',
      'toggle-sidebar-tabs',
      'new-agent',
      'switch-window-layouts',
    ] as const) {
      expect(getActionKeyDefinition(id).isAvailable(context)).toBe(false);
    }
    expect(getActionKeyDefinition('new-workspace').isAvailable(context)).toBe(true);
    expect(getActionKeyDefinition('none').isAvailable(context)).toBe(false);
  });

  it('cycle-workspace-agents requires at least one foreground agent', () => {
    const empty = makeContext(makeState()).context;
    expect(getActionKeyDefinition('cycle-workspace-agents').isAvailable(empty)).toBe(false);

    const withAgents = makeContext(
      makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }),
    ).context;
    expect(getActionKeyDefinition('cycle-workspace-agents').isAvailable(withAgents)).toBe(true);
  });

  it('cycle-in-progress-agents requires an in-progress agent anywhere', () => {
    const idle = makeContext(
      makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }),
    ).context;
    expect(getActionKeyDefinition('cycle-in-progress-agents').isAvailable(idle)).toBe(false);

    const busy = makeContext(
      makeState({
        workspaces: ['ws-1', 'ws-2'],
        agentsByWorkspace: { 'ws-2': { ids: ['a-2'] } },
        inProgressAgentIds: ['a-2'],
      }),
    ).context;
    expect(getActionKeyDefinition('cycle-in-progress-agents').isAvailable(busy)).toBe(true);
  });

  it('stop-agent requires an in-progress active agent in the active workspace', () => {
    const idle = makeContext(
      makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } } }),
    ).context;
    expect(getActionKeyDefinition('stop-agent').isAvailable(idle)).toBe(false);

    const busy = makeContext(
      makeState({
        agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } },
        inProgressAgentIds: ['a-1'],
      }),
    ).context;
    expect(getActionKeyDefinition('stop-agent').isAvailable(busy)).toBe(true);
  });
});

describe('unavailable hints', () => {
  it('cycle-in-progress-agents hints that no agents are active when all are idle', () => {
    const { context } = makeContext(
      makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }),
    );
    expect(getActionKeyDefinition('cycle-in-progress-agents').getUnavailableHint?.(context)).toBe(
      m.hardwareConsole_actionKey_noActiveAgents_message(),
    );
  });

  it('cycle-workspace-agents hints that no agents are active in an empty workspace', () => {
    const { context } = makeContext(makeState());
    expect(getActionKeyDefinition('cycle-workspace-agents').getUnavailableHint?.(context)).toBe(
      m.hardwareConsole_actionKey_noActiveAgents_message(),
    );
  });

  it('cycle-workspace-agents falls back to the generic hint without an active workspace', () => {
    const { context } = makeContext(makeState({ activeWorkspaceId: null }));
    expect(
      getActionKeyDefinition('cycle-workspace-agents').getUnavailableHint?.(context),
    ).toBeNull();
  });

  it('each global cycle action has a specific empty-state hint', () => {
    const { context } = makeContext(makeState());
    const cases = [
      ['cycle-attention-agents', m.hardwareConsole_actionKey_noAttentionAgents_message()],
      ['cycle-idle-agents', m.hardwareConsole_actionKey_noIdleAgents_message()],
      ['cycle-unread-agents', m.hardwareConsole_actionKey_noUnreadAgents_message()],
      ['cycle-failed-agents', m.hardwareConsole_actionKey_noFailedAgents_message()],
    ] as const;
    for (const [id, hint] of cases) {
      expect(getActionKeyDefinition(id).isAvailable(context)).toBe(false);
      expect(getActionKeyDefinition(id).getUnavailableHint?.(context)).toBe(hint);
    }
  });
});

describe('global cycle family', () => {
  it('cycle-attention-agents matches the LED attention definition (blocker/discussion)', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'] }, 'ws-2': { ids: ['a-2'] } },
      sessionOverrides: { 'a-2': { attentionRequestKind: 'blocker' } },
    });
    const { context, dispatch, navigate } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-attention-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-2', 'a-2'] }),
    );
  });

  it('cycle-idle-agents cycles only idle agents', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      inProgressAgentIds: ['a-1'],
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-idle-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-2'] }),
    );
  });

  it('cycle-unread-agents cycles only agents marked unread', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      unreadAgentIds: ['a-2'],
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-2'] }),
    );
  });

  it('cycle-failed-agents cycles only error-status agents', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      sessionOverrides: { 'a-2': { status: 'error' } },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-failed-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-2'] }),
    );
  });

  it('cycle-in-progress-agents orders by last idle time, most recent first', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      inProgressAgentIds: ['a-1', 'a-2'],
      sessionOverrides: {
        'a-1': { stopReasonTimestamp: '2026-08-01T10:00:00.000Z' },
        'a-2': { stopReasonTimestamp: '2026-08-01T12:00:00.000Z' },
      },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-in-progress-agents').execute(context);
    // a-2 idled more recently → it is first in the cycle.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-2'] }),
    );
  });

  it('cycle actions focus the target agent chat composer', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: null } },
      unreadAgentIds: ['a-1'],
    });
    const { context, focusComposer } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(focusComposer).toHaveBeenCalledWith('a-1');
  });
});

describe('execute dispatch', () => {
  it('cycle-workspace-agents focuses the next foreground agent', () => {
    const { context, dispatch } = makeContext(
      makeState({
        agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: 'a-1' } },
      }),
    );
    getActionKeyDefinition('cycle-workspace-agents').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-2'] }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'a-2' }],
      }),
    );
  });

  it('cycle-in-progress-agents navigates cross-workspace to the next running agent', () => {
    const { context, dispatch, navigate } = makeContext(
      makeState({
        workspaces: ['ws-1', 'ws-2'],
        agentsByWorkspace: {
          'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
          'ws-2': { ids: ['a-2'] },
        },
        inProgressAgentIds: ['a-1', 'a-2'],
      }),
    );
    getActionKeyDefinition('cycle-in-progress-agents').execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-2', 'a-2'] }),
    );
  });

  it('stop-agent dispatches the stop-chat trigger and focuses the composer', () => {
    const { context, dispatch, focusComposer } = makeContext(
      makeState({
        agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } },
        inProgressAgentIds: ['a-1'],
      }),
    );
    getActionKeyDefinition('stop-agent').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agentSessions/stopChatRequested', payload: ['a-1'] }),
    );
    expect(focusComposer).toHaveBeenCalledWith('a-1');
  });

  it('see-spec opens the workspace spec note', () => {
    const { context, dispatch } = makeContext(makeState());
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec'],
      }),
    );
  });

  it('toggle-sidebar-tabs cycles to the next single-selected tab', () => {
    const { context, dispatch } = makeContext(
      makeState({ selectedTabs: { 'ws-1': ['agents'] } }),
    );
    getActionKeyDefinition('toggle-sidebar-tabs').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sidebarNav/setMultiSelectSidebarSelectedTabs',
        payload: ['ws-1', ['context']],
      }),
    );
  });

  it('new-agent dispatches the specialist-picker creation trigger', () => {
    const { context, dispatch } = makeContext(makeState());
    getActionKeyDefinition('new-agent').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceAgents/createAgentWithSpecialistRequested',
        payload: ['ws-1', null],
      }),
    );
  });

  it('new-workspace opens the create-workspace modal', () => {
    const { context, dispatch } = makeContext(makeState({ activeWorkspaceId: null }));
    getActionKeyDefinition('new-workspace').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sidebarNav/setShowCreateModal', payload: [true] }),
    );
  });

  it('switch-window-layouts cycles through the layout presets per workspace', () => {
    const { context, dispatch } = makeContext(makeState());
    getActionKeyDefinition('switch-window-layouts').execute(context);
    getActionKeyDefinition('switch-window-layouts').execute(context);
    const presets = dispatch.mock.calls
      .map(([action]) => action as { type: string; payload: { preset?: string } })
      .filter((action) => action.type === 'panelLayout/applyPreset')
      .map((action) => action.payload.preset);
    expect(presets).toEqual(['single', 'split-horizontal']);
  });

  it('none executes as a no-op', () => {
    const { context, dispatch, navigate } = makeContext(makeState());
    getActionKeyDefinition('none').execute(context);
    expect(dispatch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
