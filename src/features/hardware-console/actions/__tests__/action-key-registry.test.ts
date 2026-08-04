import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import {
  ACTION_KEY_REGISTRY,
  actionSlotIcons,
  getActionKeyDefinition,
  resetActionKeyCycleCursors,
  type ActionKeyContext,
  type ActionKeyState,
} from '../action-key-registry';
import { ACTION_KEY_ACTION_IDS, DEFAULT_ACTION_MAPPINGS } from '../action-mapping';
import { DEFAULT_CYCLE_SCOPES, type CycleScope, type CycleScopeFamilyId } from '../cycle-scope';

function makeWorkspace(id: string, attention?: 'unread'): Workspace {
  return { id, attention } as unknown as Workspace;
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
  agentsByWorkspace?: Record<
    string,
    { ids: string[]; activeAgentId?: string | null; subAgentIds?: string[] }
  >;
  inProgressAgentIds?: string[];
  sessionOverrides?: Record<string, Record<string, unknown>>;
  unreadWorkspaceIds?: string[];
  selectedTabs?: Record<string, string[]>;
  cycleScopes?: Partial<Record<CycleScopeFamilyId, CycleScope>>;
}

function makeState(options: StateOptions = {}): ActionKeyState {
  const workspaceIds = options.workspaces ?? ['ws-1'];
  const byWorkspaceId: ActionKeyState['workspaceAgents']['byWorkspaceId'] = {};
  const byAgentId: ActionKeyState['agentSessions']['byAgentId'] = {};
  for (const [wsId, entry] of Object.entries(options.agentsByWorkspace ?? {})) {
    const subAgentIds = entry.subAgentIds ?? [];
    byWorkspaceId[wsId] = {
      agentIds: [...entry.ids, ...subAgentIds],
      foregroundAgentIds: entry.ids,
      activeAgentId: entry.activeAgentId ?? null,
    };
    for (const agentId of [...entry.ids, ...subAgentIds]) {
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
      workspaces: createCollection(
        'id',
        workspaceIds.map((id) =>
          makeWorkspace(id, options.unreadWorkspaceIds?.includes(id) ? 'unread' : undefined),
        ),
      ),
    },
    workspaceAgents: { byWorkspaceId },
    agentSessions: { byAgentId },
    hardwareConsole: {
      cycleScopeByFamily: { ...DEFAULT_CYCLE_SCOPES, ...options.cycleScopes },
    },
    sidebarNav: {
      multiSelectTabOrder: [],
      multiSelectSelectedTabIdsByWorkspaceId: options.selectedTabs ?? {},
    },
  };
}

/** An assistant message carrying a pending wizard question resource block. */
function questionMessage(messageId: string) {
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
  } as never;
}

function makeContext(state: ActionKeyState) {
  const dispatch = vi.fn();
  const navigate = vi.fn(() => Promise.resolve());
  const focusComposer = vi.fn();
  const showHint = vi.fn();
  const context: ActionKeyContext = { state, dispatch, navigate, focusComposer, showHint };
  return { context, dispatch, navigate, focusComposer, showHint };
}

/** The setActiveAgentId payloads dispatched, in order. */
function activeAgentDispatches(dispatch: ReturnType<typeof vi.fn>): unknown[] {
  return dispatch.mock.calls
    .map(([action]) => action as { type: string; payload: unknown })
    .filter((action) => action.type === 'workspaceAgents/setActiveAgentId')
    .map((action) => action.payload);
}

beforeEach(() => {
  resetActionKeyCycleCursors();
});

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

  it('cycle-workspace-agents requires at least one agent anywhere (global)', () => {
    const empty = makeContext(makeState()).context;
    expect(getActionKeyDefinition('cycle-workspace-agents').isAvailable(empty)).toBe(false);

    // Agents only in a non-active workspace still make it available.
    const withAgents = makeContext(
      makeState({
        workspaces: ['ws-1', 'ws-2'],
        agentsByWorkspace: { 'ws-2': { ids: ['a-1'] } },
      }),
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
  it('cycle-in-progress-agents hints that no agents are in progress when all are idle', () => {
    const { context } = makeContext(makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }));
    expect(getActionKeyDefinition('cycle-in-progress-agents').getUnavailableHint?.(context)).toBe(
      m.hardwareConsole_actionKey_noInProgressAgents_message(),
    );
  });

  it('each global cycle action has a specific empty-state hint naming its filter', () => {
    const { context } = makeContext(makeState());
    const cases = [
      ['cycle-workspace-agents', m.hardwareConsole_actionKey_noAgents_message()],
      ['cycle-in-progress-agents', m.hardwareConsole_actionKey_noInProgressAgents_message()],
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-2', 'a-2'],
      }),
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-1', 'a-2'],
      }),
    );
  });

  it('cycle-unread-agents cycles agents of workspaces marked unread', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['a-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context, dispatch, navigate } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-2', 'a-2'],
      }),
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-1', 'a-2'],
      }),
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-1', 'a-2'],
      }),
    );
  });

  it('cycle actions focus the target agent chat composer', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
    });
    const { context, focusComposer } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(focusComposer).toHaveBeenCalledWith('a-1');
  });

  it('a successful cycle step shows the action HUD with the action label', () => {
    const cases = [
      ['cycle-workspace-agents', {}, m.hardwareConsole_actionKey_cycleWorkspaceAgents_label()],
      [
        'cycle-in-progress-agents',
        { inProgressAgentIds: ['a-1', 'a-2'] },
        m.hardwareConsole_actionKey_cycleInProgressAgents_label(),
      ],
    ] as const;
    for (const [id, options, label] of cases) {
      resetActionKeyCycleCursors();
      const state = makeState({
        agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: 'a-1' } },
        ...options,
      });
      const { context, dispatch } = makeContext(state);
      getActionKeyDefinition(id).execute(context);
      expect(dispatch, id).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hardwareConsole/actionHudShown',
          payload: [label],
        }),
      );
    }
  });
});

describe('cycle-unread-agents union (unread workspaces + attention requests)', () => {
  it('includes an attention-requesting agent whose workspace is not unread', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['a-2'], activeAgentId: null },
      },
      sessionOverrides: { 'a-2': { attentionRequestKind: 'blocker' } },
    });
    const { context, dispatch, navigate } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    // Available even though no workspace is unread (DoD: attention-only).
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-2', 'a-2']]);
    // No attention-clearing side effect — only focus/HUD dispatches.
    const types = dispatch.mock.calls.map(([action]) => (action as { type: string }).type);
    expect(new Set(types)).toEqual(
      new Set([
        'hardwareConsole/actionHudShown',
        'workspaceAgents/setActiveAgentId',
        'appLayout/openAgentTabRequested',
      ]),
    );
  });

  it('includes an agent with a pending wizard question (no unread workspace)', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      sessionOverrides: { 'a-2': { messages: [questionMessage('msg-1')] } },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-1', 'a-2']]);
  });

  it('unions unread-workspace agents with attention agents without duplicates', () => {
    // a-1 sits in an unread workspace AND requests attention — it must
    // appear once; the walk alternates between it and the attention-only b-1.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: {
        'a-1': { attentionRequestKind: 'discussion' },
        'b-1': { attentionRequestKind: 'blocker' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-2', 'b-1'],
      ['ws-1', 'a-1'],
    ]);
  });

  it("the attention portion honors the 'cycle-attention-agents' scope", () => {
    const makeSubAgentState = (scope: CycleScope) =>
      makeState({
        agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
        sessionOverrides: { 'sub-1': { attentionRequestKind: 'blocker' } },
        cycleScopes: { 'cycle-attention-agents': scope },
      });
    const definition = getActionKeyDefinition('cycle-unread-agents');

    const topLevel = makeContext(makeSubAgentState('top-level'));
    expect(definition.isAvailable(topLevel.context)).toBe(false);

    const all = makeContext(makeSubAgentState('all'));
    expect(definition.isAvailable(all.context)).toBe(true);
    definition.execute(all.context);
    expect(activeAgentDispatches(all.dispatch)).toEqual([['ws-1', 'sub-1']]);
  });

  it("the unread-workspace portion stays top-level even with attention scope 'all'", () => {
    const state = makeState({
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], subAgentIds: ['sub-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1'],
      cycleScopes: { 'cycle-attention-agents': 'all' },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    // sub-1 needs no attention → never cycled into; only the top-level walk.
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-1'],
    ]);
  });
});

describe('cycle scope (sub-agents)', () => {
  it('failed defaults to including sub-agents', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
      sessionOverrides: { 'sub-1': { status: 'error' } },
    });
    const { context } = makeContext(state);
    expect(getActionKeyDefinition('cycle-failed-agents').isAvailable(context)).toBe(true);
  });

  it('in-progress and attention default to top-level only', () => {
    const cases = [
      ['cycle-in-progress-agents', {}, true],
      ['cycle-attention-agents', { attentionRequestKind: 'blocker', status: 'Completed' }, false],
    ] as const;
    for (const [id, overrides, inProgress] of cases) {
      const state = makeState({
        agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
        inProgressAgentIds: inProgress ? ['sub-1'] : [],
        sessionOverrides: { 'sub-1': { ...overrides } },
      });
      const { context } = makeContext(state);
      expect(getActionKeyDefinition(id).isAvailable(context), id).toBe(false);
    }
  });

  it("a family set to 'all' includes sub-agents in its walk", () => {
    const cases = [
      ['cycle-in-progress-agents', {}, true],
      ['cycle-attention-agents', { attentionRequestKind: 'blocker', status: 'Completed' }, false],
    ] as const;
    for (const [id, overrides, inProgress] of cases) {
      const state = makeState({
        agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
        inProgressAgentIds: inProgress ? ['sub-1'] : [],
        sessionOverrides: { 'sub-1': { ...overrides } },
        cycleScopes: { [id]: 'all' },
      });
      const { context } = makeContext(state);
      expect(getActionKeyDefinition(id).isAvailable(context), id).toBe(true);
    }
  });

  it('idle defaults to top-level only', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
    });
    const { context } = makeContext(state);
    expect(getActionKeyDefinition('cycle-idle-agents').isAvailable(context)).toBe(false);
  });

  it("a family set to 'top-level' excludes sub-agents from its walk", () => {
    const state = makeState({
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], subAgentIds: ['sub-1'], activeAgentId: null },
      },
      inProgressAgentIds: ['a-1', 'sub-1'],
      cycleScopes: { 'cycle-in-progress-agents': 'top-level' },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-in-progress-agents');
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-1'],
    ]);
  });

  it("an 'all'-scoped family cycles into a sub-agent and focuses its tab + composer", () => {
    const state = makeState({
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], subAgentIds: ['sub-1'], activeAgentId: 'a-1' },
      },
      sessionOverrides: {
        'a-1': { status: 'error' },
        'sub-1': { status: 'error' },
      },
    });
    const { context, dispatch, focusComposer } = makeContext(state);
    getActionKeyDefinition('cycle-failed-agents').execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-1', 'sub-1']]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'sub-1' }],
      }),
    );
    expect(focusComposer).toHaveBeenCalledWith('sub-1');
  });

  it('cycle-workspace-agents stays top-level regardless of the scope settings', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: [], subAgentIds: ['sub-1'], activeAgentId: null } },
    });
    const { context } = makeContext(state);
    expect(getActionKeyDefinition('cycle-workspace-agents').isAvailable(context)).toBe(false);
  });
});

describe('round-robin across presses', () => {
  it('two in-progress agents in one workspace alternate press after press', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      inProgressAgentIds: ['a-1', 'a-2'],
      sessionOverrides: {
        'a-1': { stopReasonTimestamp: '2026-08-01T12:00:00.000Z' },
        'a-2': { stopReasonTimestamp: '2026-08-01T10:00:00.000Z' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-in-progress-agents');
    // The state anchor (activeAgentId) never updates in this mock —
    // exactly the lag that trapped the walk. The cursor must advance anyway.
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-2'],
      ['ws-1', 'a-1'],
      ['ws-1', 'a-2'],
    ]);
  });

  it('walks in-progress agents across all workspaces and wraps', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
        'ws-2': { ids: ['b-1'] },
      },
      inProgressAgentIds: ['a-1', 'b-1'],
      sessionOverrides: {
        'a-1': { stopReasonTimestamp: '2026-08-01T12:00:00.000Z' },
        'b-1': { stopReasonTimestamp: '2026-08-01T10:00:00.000Z' },
      },
    });
    const { context, dispatch, navigate } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-in-progress-agents');
    definition.execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    // Second press: the store still says ws-1/a-1 is active (navigation is
    // async), but the cursor knows the walk is at b-1 → wrap back to a-1.
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-2', 'b-1'],
      ['ws-1', 'a-1'],
    ]);
  });

  it('cycle-workspace-agents advances and never silently no-ops when agents exist', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
        'ws-2': { ids: ['b-1'] },
      },
    });
    const { context, dispatch, navigate, showHint } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-workspace-agents');
    expect(definition.isAvailable(context)).toBe(true);
    definition.execute(context);
    definition.execute(context);
    expect(showHint).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-2', 'b-1'],
      ['ws-1', 'a-1'],
    ]);
  });

  it('cycle-workspace-agents works without an active workspace (global)', () => {
    const state = makeState({
      activeWorkspaceId: null,
      workspaces: ['ws-1'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } },
    });
    const { context, dispatch, navigate } = makeContext(state);
    getActionKeyDefinition('cycle-workspace-agents').execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-1');
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-1', 'a-1']]);
  });

  it('a stale cursor no longer in the candidate list falls back to the focused anchor', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      inProgressAgentIds: ['a-1', 'a-2'],
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-in-progress-agents');
    definition.execute(context);
    // a-1 (the cursor) stops being in progress; a-3 joins.
    const next = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2', 'a-3'], activeAgentId: null } },
      inProgressAgentIds: ['a-2', 'a-3'],
    });
    const second = makeContext(next);
    definition.execute(second.context);
    expect(activeAgentDispatches(dispatch)[0]).toEqual(['ws-1', 'a-1']);
    expect(activeAgentDispatches(second.dispatch)[0]).toEqual(['ws-1', 'a-2']);
  });
});

describe('single-candidate toast', () => {
  it('toasts instead of navigating when the only candidate is already focused', () => {
    const cases = [
      [
        'cycle-in-progress-agents',
        { inProgressAgentIds: ['a-1'] },
        m.hardwareConsole_actionKey_noOtherInProgressAgents_message(),
      ],
      [
        'cycle-attention-agents',
        { sessionOverrides: { 'a-1': { attentionRequestKind: 'blocker' } } },
        m.hardwareConsole_actionKey_noOtherAttentionAgents_message(),
      ],
      ['cycle-idle-agents', {}, m.hardwareConsole_actionKey_noOtherIdleAgents_message()],
      [
        'cycle-unread-agents',
        { unreadWorkspaceIds: ['ws-1'] },
        m.hardwareConsole_actionKey_noOtherUnreadAgents_message(),
      ],
      [
        'cycle-failed-agents',
        { sessionOverrides: { 'a-1': { status: 'error' } } },
        m.hardwareConsole_actionKey_noOtherFailedAgents_message(),
      ],
      ['cycle-workspace-agents', {}, m.hardwareConsole_actionKey_noOtherAgents_message()],
    ] as const;
    for (const [id, options, hint] of cases) {
      resetActionKeyCycleCursors();
      const state = makeState({
        agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } },
        ...options,
      });
      const { context, dispatch, navigate, showHint } = makeContext(state);
      getActionKeyDefinition(id).execute(context);
      expect(showHint, id).toHaveBeenCalledExactlyOnceWith(hint);
      expect(dispatch, id).not.toHaveBeenCalled();
      expect(navigate, id).not.toHaveBeenCalled();
    }
  });

  it('a single candidate that is NOT focused is a real switch — no toast', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: 'a-2' } },
      inProgressAgentIds: ['a-1'],
    });
    const { context, dispatch, showHint } = makeContext(state);
    getActionKeyDefinition('cycle-in-progress-agents').execute(context);
    expect(showHint).not.toHaveBeenCalled();
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-1', 'a-1']]);
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-1', 'a-2'],
      }),
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
      expect.objectContaining({
        type: 'workspaceAgents/setActiveAgentId',
        payload: ['ws-2', 'a-2'],
      }),
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
    const { context, dispatch } = makeContext(makeState({ selectedTabs: { 'ws-1': ['agents'] } }));
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

describe('actionSlotIcons', () => {
  it('resolves each assigned action to its registry icon and label, in slot order', () => {
    const mapping = DEFAULT_ACTION_MAPPINGS['creator-micro-2'];
    expect(actionSlotIcons(mapping)).toEqual(
      mapping.map((actionId) => ({
        icon: getActionKeyDefinition(actionId).icon,
        label: getActionKeyDefinition(actionId).label,
      })),
    );
  });

  it('maps none to a null icon and label (blank key face, no tooltip)', () => {
    expect(actionSlotIcons(['none', 'new-agent', 'none'])).toEqual([
      { icon: null, label: null },
      {
        icon: getActionKeyDefinition('new-agent').icon,
        label: getActionKeyDefinition('new-agent').label,
      },
      { icon: null, label: null },
    ]);
  });

  it('exposes label as a getter delegating to the registry so it re-evaluates on locale change', () => {
    const [slot] = actionSlotIcons(['new-agent']);
    const descriptor = Object.getOwnPropertyDescriptor(slot, 'label');
    expect(descriptor?.get).toBeTypeOf('function');

    const definition = getActionKeyDefinition('new-agent');
    const spy = vi.spyOn(definition, 'label', 'get').mockReturnValue('Nouvel agent');
    try {
      expect(slot.label).toBe('Nouvel agent');
    } finally {
      spy.mockRestore();
    }
    expect(slot.label).toBe(definition.label);
  });
});
