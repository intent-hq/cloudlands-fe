import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';

vi.mock('../../voice/voice-recorder', () => ({
  isVoiceRecordingSupported: vi.fn(() => true),
}));

vi.mock('../../voice/ptt-controller', () => ({
  handleVoiceKeyDown: vi.fn(),
  handleVoiceKeyUp: vi.fn(),
  isPttRecordingActive: vi.fn(() => false),
}));

vi.mock('../../voice/voice-setup-toast', () => ({
  showVoiceSetupToast: vi.fn(),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn((workspaceId: string) => ({ workspaceId })),
}));

vi.mock('$features/layout/preset-executor', () => ({
  applyContentPreset: vi.fn(async () => true),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ cycled: true, windowCount: 2 })),
}));

vi.mock('$lib/utils/platform-capabilities', () => ({
  isElectronPlatform: vi.fn(() => true),
}));

import { isVoiceRecordingSupported } from '../../voice/voice-recorder';
import {
  handleVoiceKeyDown,
  handleVoiceKeyUp,
  isPttRecordingActive,
} from '../../voice/ptt-controller';
import { showVoiceSetupToast } from '../../voice/voice-setup-toast';
import { applyContentPreset } from '$features/layout/preset-executor';
import { invoke } from '$lib/electron-bridge';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { IPC_CHANNELS } from '$shared/ipc-registry';
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
  currentWorkspaceId?: string | null;
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
  voiceSettings?: Partial<ActionKeyState['voiceSettings']>;
  panelLayout?: ActionKeyState['panelLayout']['byWorkspaceId'];
}

type TestActionKeyState = ActionKeyState & { currentWorkspaceId: string | null };

function makeState(options: StateOptions = {}): TestActionKeyState {
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
    currentWorkspaceId:
      options.currentWorkspaceId === undefined ? 'ws-1' : options.currentWorkspaceId,
    workspace: {
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
    voiceSettings: {
      isLoading: false,
      engine: 'daemon',
      osEngineAvailable: false,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: true, openai: false },
      ...options.voiceSettings,
    },
    panelLayout: { byWorkspaceId: options.panelLayout ?? {} },
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

function makeContext(state: TestActionKeyState) {
  const dispatch = vi.fn();
  const navigate = vi.fn(() => Promise.resolve());
  const focusComposer = vi.fn();
  const showHint = vi.fn();
  const context: ActionKeyContext = {
    state,
    workspaceId: state.currentWorkspaceId,
    dispatch,
    navigate,
    focusComposer,
    showHint,
  };
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
  vi.clearAllMocks();
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
    const { context } = makeContext(makeState({ currentWorkspaceId: null }));
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

describe('cycle-unread-agents HUD remaining count', () => {
  /** The actionHudShown payloads dispatched, in order. */
  function hudDispatches(dispatch: ReturnType<typeof vi.fn>): unknown[] {
    return dispatch.mock.calls
      .map(([action]) => action as { type: string; payload: unknown })
      .filter((action) => action.type === 'hardwareConsole/actionHudShown')
      .map((action) => action.payload);
  }

  it('shows "(X more to go)" counting other unread workspaces, not their agents', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2', 'ws-3'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
        'ws-3': { ids: ['c-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2', 'ws-3'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_many({ count: 2 })],
    ]);
  });

  it('shows the singular "(1 more to go)" form with two unread workspaces', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_one({ count: 1 })],
    ]);
  });

  it('counts 0 remaining when one unread workspace holds several agents', () => {
    // Visiting one agent of the workspace clears its whole unread flag, so
    // its sibling agents are not further stops.
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2', 'a-3'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
    ]);
  });

  it('counts attention agents individually even alongside an unread workspace', () => {
    // Attention persists per-agent until handled, so a separate attention
    // agent stays one more stop after the unread workspace is visited.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: { 'b-1': { attentionRequestKind: 'blocker' } },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_one({ count: 1 })],
    ]);
  });

  it('counts 0 remaining when the visited attention agent shares the unread workspace', () => {
    // The attention agent is visited first (attention precedes unread) and
    // visiting it clears its own workspace's unread flag, so the unread
    // stop of that same workspace is not a further stop.
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: { 'a-2': { attentionRequestKind: 'discussion' } },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-1', 'a-2']]);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
    ]);
  });

  it('shows the plain label (no suffix) when the single candidate is not focused', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context, dispatch, showHint } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(showHint).not.toHaveBeenCalled();
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
    ]);
  });

  it('counts one remaining stop per other unread workspace regardless of its agent count', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null },
        'ws-2': { ids: ['b-1', 'b-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_one({ count: 1 })],
    ]);
  });

  it('other cycle families keep their plain label regardless of remaining count', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2', 'a-3'], activeAgentId: null } },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-idle-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleIdleAgents_label()],
    ]);
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
    // appear once, at its attention position; the walk alternates between
    // the blocker b-1 (highest bucket) and the discussion a-1.
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
      ['ws-2', 'b-1'],
      ['ws-1', 'a-1'],
      ['ws-2', 'b-1'],
    ]);
  });

  it('walks blocker → question → discussion → unread regardless of workspace order', () => {
    // Workspace order is deliberately the reverse of the priority order.
    const state = makeState({
      workspaces: ['ws-u', 'ws-d', 'ws-q', 'ws-b'],
      agentsByWorkspace: {
        'ws-u': { ids: ['u-1'], activeAgentId: null },
        'ws-d': { ids: ['d-1'], activeAgentId: null },
        'ws-q': { ids: ['q-1'], activeAgentId: null },
        'ws-b': { ids: ['b-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-u'],
      sessionOverrides: {
        'd-1': { attentionRequestKind: 'discussion' },
        'q-1': { messages: [questionMessage('msg-1')] },
        'b-1': { attentionRequestKind: 'blocker' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-b', 'b-1'],
      ['ws-q', 'q-1'],
      ['ws-d', 'd-1'],
      ['ws-u', 'u-1'],
      ['ws-b', 'b-1'],
    ]);
  });

  it('agents in the same bucket keep the workspace walk order', () => {
    // Two blockers and two questions across workspaces: priority groups
    // them (blockers first), and inside each bucket the workspace order
    // (ws-1, ws-2, ...) is preserved — never re-sorted.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2', 'ws-3', 'ws-4'],
      agentsByWorkspace: {
        'ws-1': { ids: ['q-1'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
        'ws-3': { ids: ['q-2'], activeAgentId: null },
        'ws-4': { ids: ['b-2'], activeAgentId: null },
      },
      sessionOverrides: {
        'q-1': { messages: [questionMessage('msg-1')] },
        'b-1': { attentionRequestKind: 'blocker' },
        'q-2': { messages: [questionMessage('msg-2')] },
        'b-2': { attentionRequestKind: 'blocker' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-2', 'b-1'],
      ['ws-4', 'b-2'],
      ['ws-1', 'q-1'],
      ['ws-3', 'q-2'],
    ]);
  });

  it('an agent with several attention signals classifies at its highest bucket', () => {
    // dq-1 (discussion + question) walks in the question bucket — after the
    // blocker+question bq-1 (blocker wins) and before the discussion-only d-1.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2', 'ws-3'],
      agentsByWorkspace: {
        'ws-1': { ids: ['d-1'], activeAgentId: null },
        'ws-2': { ids: ['dq-1'], activeAgentId: null },
        'ws-3': { ids: ['bq-1'], activeAgentId: null },
      },
      sessionOverrides: {
        'd-1': { attentionRequestKind: 'discussion' },
        'dq-1': { attentionRequestKind: 'discussion', messages: [questionMessage('msg-1')] },
        'bq-1': { attentionRequestKind: 'blocker', messages: [questionMessage('msg-2')] },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-3', 'bq-1'],
      ['ws-2', 'dq-1'],
      ['ws-1', 'd-1'],
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

describe('cycle-unread-agents last-active pick (intent-hq/monorepo#1779)', () => {
  it('opens the last active top-level agent of an unread workspace, not the first in order', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
        'ws-2': { ids: ['b-1', 'b-2', 'b-3'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-2'],
      sessionOverrides: {
        'b-1': { lastActivity: '2026-08-01T08:00:00.000Z' },
        'b-2': { stopReasonTimestamp: '2026-08-01T12:00:00.000Z' },
        'b-3': { lastActivity: '2026-08-01T10:00:00.000Z' },
      },
    });
    const { context, dispatch, navigate } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-2', 'b-2']]);
  });

  it('falls back to the first foreground agent when no recency signal exists', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' },
        'ws-2': { ids: ['b-1', 'b-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([['ws-2', 'b-1']]);
  });

  it('each unread workspace contributes exactly one stop — siblings are never visited', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null },
        'ws-2': { ids: ['b-1', 'b-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
      sessionOverrides: {
        'a-2': { lastActivity: '2026-08-01T10:00:00.000Z' },
        'b-1': { lastActivity: '2026-08-01T11:00:00.000Z' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-2'],
      ['ws-2', 'b-1'],
      ['ws-1', 'a-2'],
      ['ws-2', 'b-1'],
    ]);
  });
});

describe('cycle-unread-agents per-agent unread walk (new daemons)', () => {
  /** The actionHudShown payloads dispatched, in order. */
  function hudDispatches(dispatch: ReturnType<typeof vi.fn>): unknown[] {
    return dispatch.mock.calls
      .map(([action]) => action as { type: string; payload: unknown })
      .filter((action) => action.type === 'hardwareConsole/actionHudShown')
      .map((action) => action.payload);
  }

  it('visits every unread top-level agent of a workspace, in foreground order', () => {
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2', 'a-3'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: {
        'a-1': { hasUnread: true, lastMessageId: 'm-1' },
        'a-2': { hasUnread: false, lastMessageId: 'm-2' },
        'a-3': { hasUnread: true, lastMessageId: 'm-3' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-3'],
      ['ws-1', 'a-1'],
    ]);
  });

  it('groups the walk by workspace across mixed new/old-daemon workspaces', () => {
    // ws-1 serves per-agent unread (two stops); ws-2's sessions omit
    // lastMessageId (older daemon) so it keeps the single last-active stop.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null },
        'ws-2': { ids: ['b-1', 'b-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
      sessionOverrides: {
        'a-1': { hasUnread: true, lastMessageId: 'm-1' },
        'a-2': { hasUnread: true, lastMessageId: 'm-2' },
        'b-2': { lastActivity: '2026-08-01T10:00:00.000Z' },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-2'],
      ['ws-2', 'b-2'],
    ]);
  });

  it('counts per-agent stops individually in the HUD remaining count', () => {
    // Visiting a-1 marks only a-1 seen: its unread sibling a-2 stays a
    // candidate, unlike the fallback's workspace-clearing count.
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2', 'a-3'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: {
        'a-1': { hasUnread: true, lastMessageId: 'm-1' },
        'a-2': { hasUnread: true, lastMessageId: 'm-2' },
        'a-3': { hasUnread: true, lastMessageId: 'm-3' },
      },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_many({ count: 2 })],
    ]);
  });

  it('mixed count: per-agent stops count individually, fallback workspaces as one', () => {
    // Step lands on a-1 (per-agent, new daemon). Remaining: a-2 (per-agent
    // sibling) + ws-2's single fallback stop = 2, regardless of ws-2's
    // agent count.
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null },
        'ws-2': { ids: ['b-1', 'b-2'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
      sessionOverrides: {
        'a-1': { hasUnread: true, lastMessageId: 'm-1' },
        'a-2': { hasUnread: true, lastMessageId: 'm-2' },
      },
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_many({ count: 2 })],
    ]);
  });

  it('a seen-but-unread-workspace new-daemon workspace falls back to one last-active stop', () => {
    // The daemon serves lastMessageId but every agent is already seen: the
    // workspace-level unread flag still yields the single fallback stop.
    const state = makeState({
      agentsByWorkspace: { 'ws-1': { ids: ['a-1', 'a-2'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1'],
      sessionOverrides: {
        'a-1': { hasUnread: false, lastMessageId: 'm-1' },
        'a-2': {
          hasUnread: false,
          lastMessageId: 'm-2',
          stopReasonTimestamp: '2026-08-01T10:00:00.000Z',
        },
      },
    });
    const { context, dispatch } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-2'],
      ['ws-1', 'a-2'],
    ]);
    expect(hudDispatches(dispatch)).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
      [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
    ]);
  });
});

describe('cycle-unread-agents unhydrated workspaces (intent-hq/monorepo#2438)', () => {
  /** The hydrateAgentsRequested workspace ids dispatched, in order. */
  function hydrateDispatches(dispatch: ReturnType<typeof vi.fn>): unknown[] {
    return dispatch.mock.calls
      .map(([action]) => action as { type: string; payload: unknown })
      .filter((action) => action.type === 'workspaceAgents/hydrateAgentsRequested')
      .map((action) => action.payload);
  }

  it('is available when the only unread workspace has no hydrated sessions', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context } = makeContext(state);
    expect(getActionKeyDefinition('cycle-unread-agents').isAvailable(context)).toBe(true);
  });

  it('steps to the unhydrated workspace: navigates, hydrates, and focuses no agent', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: 'a-1' } },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context, dispatch, navigate, focusComposer } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    expect(hydrateDispatches(dispatch)).toEqual([['ws-2']]);
    expect(activeAgentDispatches(dispatch)).toEqual([]);
    expect(focusComposer).not.toHaveBeenCalled();
  });

  it('walks hydrated and unhydrated unread workspaces alternately without sticking', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
    });
    const { context, dispatch, navigate } = makeContext(state);
    const definition = getActionKeyDefinition('cycle-unread-agents');
    definition.execute(context);
    definition.execute(context);
    definition.execute(context);
    expect(activeAgentDispatches(dispatch)).toEqual([
      ['ws-1', 'a-1'],
      ['ws-1', 'a-1'],
    ]);
    expect(hydrateDispatches(dispatch)).toEqual([['ws-2']]);
    expect(navigate.mock.calls).toEqual([['/workspace/ws-2']]);
  });

  it('counts an unhydrated unread workspace as one remaining stop in the HUD', () => {
    const state = makeState({
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-1', 'ws-2'],
    });
    const { context, dispatch } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    const hud = dispatch.mock.calls
      .map(([action]) => action as { type: string; payload: unknown })
      .filter((action) => action.type === 'hardwareConsole/actionHudShown')
      .map((action) => action.payload);
    expect(hud).toEqual([
      [m.hardwareConsole_actionKey_cycleUnreadAgents_hudRemaining_one({ count: 1 })],
    ]);
  });

  it('shows the single-candidate hint when the only stop is the active agent-less workspace', () => {
    const state = makeState({
      currentWorkspaceId: 'ws-2',
      workspaces: ['ws-1', 'ws-2'],
      agentsByWorkspace: { 'ws-1': { ids: ['a-1'], activeAgentId: null } },
      unreadWorkspaceIds: ['ws-2'],
    });
    const { context, dispatch, navigate, showHint } = makeContext(state);
    getActionKeyDefinition('cycle-unread-agents').execute(context);
    expect(showHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noOtherUnreadAgents_message(),
    );
    expect(navigate).not.toHaveBeenCalled();
    // Still re-requests hydration so the press converges the session cache
    // even if the route-mount hydration failed.
    expect(hydrateDispatches(dispatch)).toEqual([['ws-2']]);
  });

  it('resumes the walk when a workspace-level cursor hydrates before the next press', () => {
    const before = makeState({
      workspaces: ['ws-1', 'ws-2', 'ws-3'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-3': { ids: ['c-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2', 'ws-3'],
    });
    const definition = getActionKeyDefinition('cycle-unread-agents');
    const first = makeContext(before);
    definition.execute(first.context); // -> ws-1/a-1
    definition.execute(first.context); // -> ws-2 workspace-level stop
    expect(activeAgentDispatches(first.dispatch)).toEqual([['ws-1', 'a-1']]);
    expect(hydrateDispatches(first.dispatch)).toEqual([['ws-2']]);

    // ws-2 hydrates before the next press while still unread: its stop now
    // keys by agent id, so the stored workspace-level cursor resumes from
    // that workspace's stop instead of restarting the walk at ws-1.
    const after = makeState({
      workspaces: ['ws-1', 'ws-2', 'ws-3'],
      agentsByWorkspace: {
        'ws-1': { ids: ['a-1'], activeAgentId: null },
        'ws-2': { ids: ['b-1'], activeAgentId: null },
        'ws-3': { ids: ['c-1'], activeAgentId: null },
      },
      unreadWorkspaceIds: ['ws-1', 'ws-2', 'ws-3'],
    });
    const second = makeContext(after);
    definition.execute(second.context);
    expect(activeAgentDispatches(second.dispatch)).toEqual([['ws-3', 'c-1']]);
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
      currentWorkspaceId: null,
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

  it('see-spec opens the workspace spec note when no panel layout exists', () => {
    const { context, dispatch } = makeContext(makeState());
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec'],
      }),
    );
  });

  it('see-spec splits the single open panel when opening the spec', () => {
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              default: {
                id: 'default',
                tabs: [{ id: 'tab-1', type: 'conversation' }],
                activeTabId: 'tab-1',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec', { openInAdjacentPanel: true, sourcePanelId: 'default' }],
      }),
    );
  });

  it('see-spec opens in the default placement when multiple panels exist', () => {
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              'p-1': {
                id: 'p-1',
                tabs: [{ id: 'tab-1', type: 'conversation' }],
                activeTabId: 'tab-1',
              },
              'p-2': {
                id: 'p-2',
                tabs: [{ id: 'tab-2', type: 'note', noteId: 'other-note' }],
                activeTabId: 'tab-2',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec'],
      }),
    );
  });

  it('see-spec closes the spec tab when it is the active tab of its panel', () => {
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              'p-1': {
                id: 'p-1',
                tabs: [{ id: 'tab-1', type: 'conversation' }],
                activeTabId: 'tab-1',
              },
              'p-2': {
                id: 'p-2',
                tabs: [{ id: 'tab-spec', type: 'note', noteId: 'spec' }],
                activeTabId: 'tab-spec',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/closeTab',
        payload: expect.objectContaining({ wsId: 'ws-1', tabId: 'tab-spec', panelId: 'p-2' }),
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('see-spec reveals a background spec tab instead of closing it', () => {
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              'p-1': {
                id: 'p-1',
                tabs: [{ id: 'tab-1', type: 'conversation' }],
                activeTabId: 'tab-1',
              },
              'p-2': {
                id: 'p-2',
                tabs: [
                  { id: 'tab-spec', type: 'note', noteId: 'spec' },
                  { id: 'tab-2', type: 'note', noteId: 'other-note' },
                ],
                activeTabId: 'tab-2',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec'],
      }),
    );
  });

  it('see-spec closes the active duplicate spec tab even when it is not the first', () => {
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              'p-1': {
                id: 'p-1',
                tabs: [
                  { id: 'tab-spec-a', type: 'note', noteId: 'spec' },
                  { id: 'tab-spec-b', type: 'note', noteId: 'spec' },
                ],
                activeTabId: 'tab-spec-b',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/closeTab',
        payload: expect.objectContaining({ wsId: 'ws-1', tabId: 'tab-spec-b', panelId: 'p-1' }),
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('see-spec reveals a background spec tab in a single panel via the adjacent-split path', () => {
    // The reducer's openTabInAdjacentOrSplit finds the equivalent tab across
    // all panels before splitting, so this dispatch reveals the existing tab
    // rather than duplicating it.
    const { context, dispatch } = makeContext(
      makeState({
        panelLayout: {
          'ws-1': {
            panels: {
              'p-1': {
                id: 'p-1',
                tabs: [
                  { id: 'tab-spec', type: 'note', noteId: 'spec' },
                  { id: 'tab-1', type: 'conversation' },
                ],
                activeTabId: 'tab-1',
              },
            },
          },
        },
      }),
    );
    getActionKeyDefinition('see-spec').execute(context);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: ['ws-1', 'spec', { openInAdjacentPanel: true, sourcePanelId: 'p-1' }],
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
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

  it('new-workspace navigates to the Untitled workspace route', () => {
    const state = makeState({ currentWorkspaceId: null });
    const { context, navigate } = makeContext(state);
    expect(getActionKeyDefinition('new-workspace').isAvailable(context)).toBe(true);
    getActionKeyDefinition('new-workspace').execute(context);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/workspace\/new\?instance=/));
  });

  it('switch-window-layouts cycles through the content presets per workspace', async () => {
    const applyContentPresetMock = applyContentPreset as ReturnType<typeof vi.fn>;
    applyContentPresetMock.mockClear();
    const { context } = makeContext(makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }));
    getActionKeyDefinition('switch-window-layouts').execute(context);
    await vi.waitFor(() => {
      expect(applyContentPresetMock).toHaveBeenCalledTimes(1);
    });
    getActionKeyDefinition('switch-window-layouts').execute(context);
    await vi.waitFor(() => {
      expect(applyContentPresetMock).toHaveBeenCalledTimes(2);
    });
    const presets = applyContentPresetMock.mock.calls.map(([presetId]) => presetId);
    expect(presets).toEqual(['planning', 'agents-row']);
    expect(applyContentPresetMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
    expect(applyContentPresetMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('switch-window-layouts walks all four presets when the workspace has agents', async () => {
    const applyContentPresetMock = applyContentPreset as ReturnType<typeof vi.fn>;
    applyContentPresetMock.mockClear();
    const { context } = makeContext(makeState({ agentsByWorkspace: { 'ws-1': { ids: ['a-1'] } } }));
    for (let press = 1; press <= 5; press++) {
      getActionKeyDefinition('switch-window-layouts').execute(context);
      await vi.waitFor(() => {
        expect(applyContentPresetMock).toHaveBeenCalledTimes(press);
      });
    }
    expect(applyContentPresetMock.mock.calls.map(([presetId]) => presetId)).toEqual([
      'planning',
      'agents-row',
      'changes',
      'review',
      'planning',
    ]);
  });

  it('switch-window-layouts skips agents-row when the workspace has no agents', async () => {
    const applyContentPresetMock = applyContentPreset as ReturnType<typeof vi.fn>;
    applyContentPresetMock.mockClear();
    const { context, showHint } = makeContext(makeState());
    for (let press = 1; press <= 4; press++) {
      getActionKeyDefinition('switch-window-layouts').execute(context);
      await vi.waitFor(() => {
        expect(applyContentPresetMock).toHaveBeenCalledTimes(press);
      });
    }
    // No dead press: the cycle is planning → changes → review → planning.
    expect(applyContentPresetMock.mock.calls.map(([presetId]) => presetId)).toEqual([
      'planning',
      'changes',
      'review',
      'planning',
    ]);
    expect(showHint).not.toHaveBeenCalled();
  });

  it('switch-window-layouts hints when the preset resolves false (race fallback)', async () => {
    const applyContentPresetMock = applyContentPreset as ReturnType<typeof vi.fn>;
    applyContentPresetMock.mockClear();
    applyContentPresetMock.mockResolvedValueOnce(false);
    const { context, showHint } = makeContext(makeState());
    getActionKeyDefinition('switch-window-layouts').execute(context);
    await vi.waitFor(() => {
      expect(showHint).toHaveBeenCalledExactlyOnceWith(
        m.hardwareConsole_actionKey_switchWindowLayouts_notApplicable_hint(),
      );
    });
  });

  it('switch-window-layouts catches and logs a rejected preset application', async () => {
    const applyContentPresetMock = applyContentPreset as ReturnType<typeof vi.fn>;
    applyContentPresetMock.mockClear();
    applyContentPresetMock.mockRejectedValueOnce(new Error('boom'));
    const { context } = makeContext(makeState());
    expect(() => getActionKeyDefinition('switch-window-layouts').execute(context)).not.toThrow();
    await vi.waitFor(() => {
      expect(applyContentPresetMock).toHaveBeenCalledTimes(1);
    });
  });

  it('none executes as a no-op', () => {
    const { context, dispatch, navigate } = makeContext(makeState());
    getActionKeyDefinition('none').execute(context);
    expect(dispatch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('cycle-open-windows', () => {
  const invokeMock = invoke as ReturnType<typeof vi.fn>;
  const definition = () => getActionKeyDefinition('cycle-open-windows');

  it('availability follows the Electron platform gate', () => {
    const { context } = makeContext(makeState({ currentWorkspaceId: null }));
    expect(definition().isAvailable(context)).toBe(true);
    (isElectronPlatform as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    expect(definition().isAvailable(context)).toBe(false);
  });

  it('invokes the window-cycle IPC and shows the action HUD on a cycled result', async () => {
    invokeMock.mockResolvedValueOnce({ cycled: true, windowCount: 2 });
    const { context, dispatch, showHint } = makeContext(makeState());
    definition().execute(context);
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hardwareConsole/actionHudShown',
          payload: [m.hardwareConsole_actionKey_cycleOpenWindows_label()],
        }),
      );
    });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.WINDOW.CYCLE_FOCUS);
    expect(showHint).not.toHaveBeenCalled();
  });

  it('hints "no other open windows" when the result reports a single window', async () => {
    invokeMock.mockResolvedValueOnce({ cycled: false, windowCount: 1 });
    const { context, dispatch, showHint } = makeContext(makeState());
    definition().execute(context);
    await vi.waitFor(() => {
      expect(showHint).toHaveBeenCalledExactlyOnceWith(
        m.hardwareConsole_actionKey_noOtherOpenWindows_message(),
      );
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('hints when the bridge resolves undefined (browser dev build)', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { context, showHint } = makeContext(makeState());
    definition().execute(context);
    await vi.waitFor(() => {
      expect(showHint).toHaveBeenCalledExactlyOnceWith(
        m.hardwareConsole_actionKey_noOtherOpenWindows_message(),
      );
    });
  });

  it('catches and logs a rejected invoke without throwing', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    const { context, dispatch, showHint } = makeContext(makeState());
    expect(() => definition().execute(context)).not.toThrow();
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(showHint).not.toHaveBeenCalled();
  });
});

describe('push-to-talk (hold-capable)', () => {
  it('is the only hold-capable entry in the registry', () => {
    for (const entry of ACTION_KEY_REGISTRY) {
      expect(entry.executeUp !== undefined, entry.id).toBe(entry.id === 'push-to-talk');
    }
  });

  it('availability follows recording support, with a specific hint', () => {
    const { context } = makeContext(makeState());
    const definition = getActionKeyDefinition('push-to-talk');
    expect(definition.isAvailable(context)).toBe(true);
    (isVoiceRecordingSupported as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    expect(definition.isAvailable(context)).toBe(false);
    expect(definition.getUnavailableHint?.(context)).toBe(
      m.hardwareConsole_ptt_unavailable_message(),
    );
  });

  it('execute feeds the gesture keydown; executeUp the keyup', () => {
    const { context } = makeContext(makeState());
    const definition = getActionKeyDefinition('push-to-talk');
    definition.execute(context);
    expect(handleVoiceKeyDown).toHaveBeenCalledWith(context);
    expect(handleVoiceKeyUp).not.toHaveBeenCalled();
    definition.executeUp?.(context);
    expect(handleVoiceKeyUp).toHaveBeenCalledWith(context);
  });

  it('gates keydown with the setup toast when no engine can transcribe', () => {
    const { context } = makeContext(
      makeState({ voiceSettings: { keyConfigured: { elevenlabs: false, openai: false } } }),
    );
    const definition = getActionKeyDefinition('push-to-talk');
    definition.execute(context);
    expect(showVoiceSetupToast).toHaveBeenCalledTimes(1);
    expect(handleVoiceKeyDown).not.toHaveBeenCalled();
  });

  it('does not gate when the missing key falls back to the OS engine', () => {
    const { context } = makeContext(
      makeState({
        voiceSettings: {
          keyConfigured: { elevenlabs: false, openai: false },
          osEngineAvailable: true,
        },
      }),
    );
    getActionKeyDefinition('push-to-talk').execute(context);
    expect(showVoiceSetupToast).not.toHaveBeenCalled();
    expect(handleVoiceKeyDown).toHaveBeenCalledWith(context);
  });

  it('never gates a live (latched) session — the stop-tap must land', () => {
    (isPttRecordingActive as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const { context } = makeContext(
      makeState({ voiceSettings: { keyConfigured: { elevenlabs: false, openai: false } } }),
    );
    getActionKeyDefinition('push-to-talk').execute(context);
    expect(showVoiceSetupToast).not.toHaveBeenCalled();
    expect(handleVoiceKeyDown).toHaveBeenCalledWith(context);
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
