import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { m } from '$shared/paraglide/messages.js';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';
import {
  DEFAULT_ACTION_MAPPINGS,
  normalizeActionMapping,
  normalizeActionMappingsByModel,
} from '../action-mapping';
import { resetActionKeyCycleCursors, type ActionKeyState } from '../action-key-registry';
import { normalizeCycleScopeByFamily } from '../cycle-scope';

const mockState: {
  hardwareConsole: {
    actionMappingByModel: Record<string, string[]>;
  } & ActionKeyState['hardwareConsole'];
} & ActionKeyState = {
  hardwareConsole: {
    actionMappingByModel: normalizeActionMappingsByModel(undefined),
    cycleScopeByFamily: normalizeCycleScopeByFamily(undefined),
  },
  workspace: {
    activeWorkspaceId: 'ws-1',
    workspaces: createCollection('id', [{ id: 'ws-1' } as never]),
  },
  workspaceAgents: { byWorkspaceId: {} },
  agentSessions: { byAgentId: {} },
  sidebarNav: { multiSelectTabOrder: [], multiSelectSelectedTabIdsByWorkspaceId: {} },
  voiceSettings: {
    isLoading: false,
    engine: 'daemon',
    osEngineAvailable: false,
    provider: 'elevenlabs',
    keyConfigured: { elevenlabs: true, openai: false },
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
  },
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: vi.fn(() => Promise.resolve()),
  isHudWindowRenderer: () => false,
}));

vi.mock('$lib/utils/window-events', () => ({
  dispatchWindowEvent: vi.fn(),
}));

vi.mock('../../voice/voice-recorder', () => ({
  isVoiceRecordingSupported: vi.fn(() => true),
}));

vi.mock('../../voice/ptt-controller', () => ({
  handleVoiceKeyDown: vi.fn(),
  handleVoiceKeyUp: vi.fn(),
  cancelPttRecording: vi.fn(),
  isPttRecordingActive: vi.fn(() => false),
}));

import { appClient } from '$lib/client';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { isVoiceRecordingSupported } from '../../voice/voice-recorder';
import {
  cancelPttRecording,
  handleVoiceKeyDown,
  handleVoiceKeyUp,
} from '../../voice/ptt-controller';
import {
  COMPOSER_FOCUS_DELAYS_MS,
  handleActionKeyPress,
  handleActionKeyRelease,
  installHardwareConsoleActionKeys,
} from '../action-key-service';

function makeFakeManager(initialStatus: HardwareConsoleStatus = 'disconnected') {
  const statusListeners = new Set<(status: HardwareConsoleStatus) => void>();
  const rawListeners = new Set<(message: unknown) => void>();
  const fake = {
    status: initialStatus,
    connectedDevice: null as { model: string } | null,
    onStatusChange(listener: (status: HardwareConsoleStatus) => void) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onRawMessage(listener: (message: unknown) => void) {
      rawListeners.add(listener);
      return () => rawListeners.delete(listener);
    },
    setStatus(status: HardwareConsoleStatus) {
      fake.status = status;
      for (const listener of statusListeners) listener(status);
    },
    emitRaw(message: unknown) {
      for (const listener of rawListeners) listener(message);
    },
    rawListenerCount: () => rawListeners.size,
  };
  return fake;
}

beforeEach(() => {
  dispatched.length = 0;
  mockState.hardwareConsole.actionMappingByModel = normalizeActionMappingsByModel(undefined);
  mockState.hardwareConsole.cycleScopeByFamily = normalizeCycleScopeByFamily(undefined);
  mockState.workspace.activeWorkspaceId = 'ws-1';
  mockState.workspace.workspaces = createCollection('id', [{ id: 'ws-1' } as never]);
  mockState.workspaceAgents.byWorkspaceId = {};
  mockState.agentSessions.byAgentId = {};
  resetActionKeyCycleCursors();
  vi.clearAllMocks();
});

describe('handleActionKeyPress', () => {
  it('executes the mapped action for an available action key', () => {
    // Slot 0 (ACT06) = new-workspace, always available.
    const result = handleActionKeyPress('ACT06');
    expect(result).toBe('new-workspace');
    expect(dispatched).toContainEqual(
      expect.objectContaining({ type: 'sidebarNav/setShowCreateModal', payload: [true] }),
    );
  });

  it('no-ops with the no-attention-agents hint when no agents need attention', () => {
    // Codex slot 1 (ACT07 checkmark) = cycle-attention-agents; nothing
    // needing attention → unavailable.
    const showUnavailableHint = vi.fn();
    const result = handleActionKeyPress('ACT07', { showUnavailableHint }, 'codex-micro');
    expect(result).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledTimes(1);
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noAttentionAgents_message(),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('no-ops with the no-in-progress-agents hint when no agents are in progress', () => {
    // Slot 5 (ACT11) = cycle-in-progress-agents; no in-progress agents anywhere.
    const showUnavailableHint = vi.fn();
    const result = handleActionKeyPress('ACT11', { showUnavailableHint });
    expect(result).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledTimes(1);
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noInProgressAgents_message(),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('no-ops with the generic hint for other unavailable actions', () => {
    // Slot 2 (ACT08) = see-spec; no active workspace → generic hint.
    mockState.workspace.activeWorkspaceId = null;
    const showUnavailableHint = vi.fn();
    const result = handleActionKeyPress('ACT08', { showUnavailableHint });
    expect(result).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_unavailable_message({
        label: m.hardwareConsole_actionKey_seeSpec_label(),
      }),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('ignores non-action keys', () => {
    const showUnavailableHint = vi.fn();
    expect(handleActionKeyPress('AG00', { showUnavailableHint })).toBeNull();
    expect(handleActionKeyPress('ENC_CLK', { showUnavailableHint })).toBeNull();
    expect(showUnavailableHint).not.toHaveBeenCalled();
  });

  it('silently no-ops for a slot mapped to none', () => {
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'] = normalizeActionMapping(
      new Array(7).fill('none'),
    );
    const showUnavailableHint = vi.fn();
    expect(handleActionKeyPress('ACT12', { showUnavailableHint })).toBeNull();
    expect(showUnavailableHint).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);
  });

  it('routes ACT10 to the Mic slot of the Codex mapping', () => {
    mockState.hardwareConsole.actionMappingByModel['codex-micro'] = normalizeActionMapping(
      ['none', 'none', 'none', 'none', 'new-workspace', 'none', 'none'],
      'codex-micro',
    );
    expect(handleActionKeyPress('ACT10', {}, 'codex-micro')).toBe('new-workspace');
  });

  it('reads the mapping of the model it is invoked for', () => {
    // Codex slot 0 (ACT06 lightning) defaults to cycle-in-progress-agents —
    // unavailable with no agents; the CM2 slot 0 default (new-workspace)
    // must not leak in.
    const showUnavailableHint = vi.fn();
    expect(handleActionKeyPress('ACT06', { showUnavailableHint }, 'codex-micro')).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noInProgressAgents_message(),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('does not fire the Codex linked-pair slot by default: ACT11 hits none', () => {
    const showUnavailableHint = vi.fn();
    expect(handleActionKeyPress('ACT11', { showUnavailableHint }, 'codex-micro')).toBeNull();
    expect(showUnavailableHint).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(0);
  });

  it('fires an explicitly assigned Codex linked-pair slot like any other key', () => {
    mockState.hardwareConsole.actionMappingByModel['codex-micro'] = normalizeActionMapping(
      ['none', 'none', 'none', 'none', 'none', 'new-workspace', 'none'],
      'codex-micro',
    );
    expect(handleActionKeyPress('ACT11', {}, 'codex-micro')).toBe('new-workspace');
  });

  it('no-ops with the no-unread-agents hint on the default ACT12 slot', () => {
    // CM2 slot 6 (ACT12, Settings row 4 key 3) = cycle-unread-agents;
    // nothing unread → specific toast.
    const showUnavailableHint = vi.fn();
    const result = handleActionKeyPress('ACT12', { showUnavailableHint });
    expect(result).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noUnreadAgents_message(),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('cycling to an unread agent focuses its chat composer', () => {
    // Codex slot 6 (ACT12 logo) = cycle-unread-agents.
    mockState.workspaceAgents.byWorkspaceId = {
      'ws-1': { agentIds: ['a-1'], foregroundAgentIds: ['a-1'], activeAgentId: null },
    };
    mockState.agentSessions.byAgentId = {
      'a-1': { id: 'a-1', status: 'Completed', messages: [] } as never,
    };
    mockState.workspace.workspaces = createCollection('id', [
      { id: 'ws-1', attention: 'unread' } as never,
    ]);
    const focusComposer = vi.fn();
    const result = handleActionKeyPress('ACT12', { focusComposer }, 'codex-micro');
    expect(result).toBe('cycle-unread-agents');
    expect(focusComposer).toHaveBeenCalledWith('a-1');
    expect(dispatched).toContainEqual(
      expect.objectContaining({ type: 'workspaceAgents/setActiveAgentId', payload: ['ws-1', 'a-1'] }),
    );
  });

  it('shows the single-candidate toast when the only in-progress agent is focused', () => {
    mockState.workspaceAgents.byWorkspaceId = {
      'ws-1': { agentIds: ['a-1'], foregroundAgentIds: ['a-1'], activeAgentId: 'a-1' },
    };
    mockState.agentSessions.byAgentId = {
      'a-1': { id: 'a-1', status: 'active', isProcessing: true, messages: [] } as never,
    };
    const showUnavailableHint = vi.fn();
    // Slot 5 (ACT11) = cycle-in-progress-agents on the CM2.
    const result = handleActionKeyPress('ACT11', { showUnavailableHint });
    expect(result).toBe('cycle-in-progress-agents');
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_actionKey_noOtherInProgressAgents_message(),
    );
    expect(dispatched).toHaveLength(0);
  });

  it('a successful cycle press shows the action HUD with the action label', () => {
    // Codex slot 6 (ACT12 logo) = cycle-unread-agents.
    mockState.workspaceAgents.byWorkspaceId = {
      'ws-1': { agentIds: ['a-1'], foregroundAgentIds: ['a-1'], activeAgentId: null },
    };
    mockState.agentSessions.byAgentId = {
      'a-1': { id: 'a-1', status: 'Completed', messages: [] } as never,
    };
    mockState.workspace.workspaces = createCollection('id', [
      { id: 'ws-1', attention: 'unread' } as never,
    ]);
    const result = handleActionKeyPress('ACT12', {}, 'codex-micro');
    expect(result).toBe('cycle-unread-agents');
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: 'hardwareConsole/actionHudShown',
        payload: [m.hardwareConsole_actionKey_cycleUnreadAgents_label()],
      }),
    );
  });

  it('does not show the action HUD on unavailable cycle presses', () => {
    // Slot 5 (ACT11) = cycle-in-progress-agents; no agents anywhere → hint only.
    const showUnavailableHint = vi.fn();
    expect(handleActionKeyPress('ACT11', { showUnavailableHint })).toBeNull();
    expect(showUnavailableHint).toHaveBeenCalledTimes(1);
    expect(dispatched).toHaveLength(0);
  });
});

describe('hold actions (push-to-talk)', () => {
  function mapPttToSlot0(): void {
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'] = normalizeActionMapping([
      'push-to-talk',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
  }

  it('keydown on a PTT-mapped key feeds the voice-key gesture handler', () => {
    mapPttToSlot0();
    expect(handleActionKeyPress('ACT06')).toBe('push-to-talk');
    expect(handleVoiceKeyDown).toHaveBeenCalledTimes(1);
    expect(handleVoiceKeyUp).not.toHaveBeenCalled();
  });

  it('keyup on a PTT-mapped key routes without an availability re-check', () => {
    mapPttToSlot0();
    (isVoiceRecordingSupported as ReturnType<typeof vi.fn>).mockReturnValue(false);
    try {
      expect(handleActionKeyRelease('ACT06')).toBe('push-to-talk');
    } finally {
      (isVoiceRecordingSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    }
    expect(handleVoiceKeyUp).toHaveBeenCalledTimes(1);
    expect(handleVoiceKeyDown).not.toHaveBeenCalled();
  });

  it('keyup on a press-only action is a no-op', () => {
    // Slot 0 (ACT06) = new-workspace on the CM2 defaults (no executeUp).
    expect(handleActionKeyRelease('ACT06')).toBeNull();
    expect(dispatched).toHaveLength(0);
  });

  it('keyup on non-action keys and none-mapped slots is a no-op', () => {
    expect(handleActionKeyRelease('AG00')).toBeNull();
    expect(handleActionKeyRelease('ENC_CLK')).toBeNull();
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'] = normalizeActionMapping(
      new Array(7).fill('none'),
    );
    expect(handleActionKeyRelease('ACT06')).toBeNull();
    expect(handleVoiceKeyUp).not.toHaveBeenCalled();
  });

  it('unavailable PTT keydown hints instead of recording', () => {
    mapPttToSlot0();
    (isVoiceRecordingSupported as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const showUnavailableHint = vi.fn();
    try {
      expect(handleActionKeyPress('ACT06', { showUnavailableHint })).toBeNull();
    } finally {
      (isVoiceRecordingSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
    }
    expect(showUnavailableHint).toHaveBeenCalledWith(
      m.hardwareConsole_ptt_unavailable_message(),
    );
    expect(handleVoiceKeyDown).not.toHaveBeenCalled();
  });
});

describe('composer focus', () => {
  it('focusAgentComposer re-dispatches the panel:focus-content seam with retries', async () => {
    vi.useFakeTimers();
    try {
      const { focusAgentComposer } = await import('../action-key-service');
      focusAgentComposer('a-1');
      expect(dispatchWindowEvent).not.toHaveBeenCalled();
      vi.advanceTimersByTime(COMPOSER_FOCUS_DELAYS_MS[COMPOSER_FOCUS_DELAYS_MS.length - 1]);
      expect(dispatchWindowEvent).toHaveBeenCalledTimes(COMPOSER_FOCUS_DELAYS_MS.length);
      expect(dispatchWindowEvent).toHaveBeenCalledWith('panel:focus-content', {
        tabType: 'agent',
        agentId: 'a-1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('new-agent press arms a one-shot composer focus fired on the next agent-tab open', async () => {
    vi.useFakeTimers();
    try {
      const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
      (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: 'hardwareConsole.state',
        value: {},
      });
      const middleware = createHardwareConsoleActionKeyMiddleware();
      const next = vi.fn((action) => action);
      const invoke = middleware({} as never)(next);

      // Slot 1 (ACT07) = new-agent.
      expect(handleActionKeyPress('ACT07')).toBe('new-agent');

      invoke({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'a-new' }],
      });
      vi.advanceTimersByTime(COMPOSER_FOCUS_DELAYS_MS[COMPOSER_FOCUS_DELAYS_MS.length - 1]);
      expect(dispatchWindowEvent).toHaveBeenCalledWith('panel:focus-content', {
        tabType: 'agent',
        agentId: 'a-new',
      });

      // One-shot: a second tab open does not re-fire.
      (dispatchWindowEvent as ReturnType<typeof vi.fn>).mockClear();
      invoke({
        type: 'appLayout/openAgentTabRequested',
        payload: ['ws-1', { agentId: 'a-other' }],
      });
      vi.advanceTimersByTime(COMPOSER_FOCUS_DELAYS_MS[COMPOSER_FOCUS_DELAYS_MS.length - 1]);
      expect(dispatchWindowEvent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('action HUD inactivity timer', () => {
  it('hides the HUD after the timeout; rapid shows re-arm it', async () => {
    vi.useFakeTimers();
    try {
      (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: 'hardwareConsole.state',
        value: {},
      });
      const { ACTION_HUD_HIDE_MS, createHardwareConsoleActionKeyMiddleware } = await import(
        '../action-key-service'
      );
      const middleware = createHardwareConsoleActionKeyMiddleware();
      const invoke = middleware({} as never)(vi.fn((action) => action));
      const hudHiddenDispatches = () =>
        dispatched.filter((action) => action.type === 'hardwareConsole/actionHudHidden');

      invoke({ type: 'hardwareConsole/actionHudShown', payload: ['Cycle idle agents'] });
      vi.advanceTimersByTime(ACTION_HUD_HIDE_MS - 1);
      expect(hudHiddenDispatches()).toHaveLength(0);

      // A rapid second press re-arms the timer.
      invoke({ type: 'hardwareConsole/actionHudShown', payload: ['Cycle idle agents'] });
      vi.advanceTimersByTime(ACTION_HUD_HIDE_MS - 1);
      expect(hudHiddenDispatches()).toHaveLength(0);

      vi.advanceTimersByTime(1);
      expect(hudHiddenDispatches()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('installHardwareConsoleActionKeys', () => {
  it('wires a decoder on connect and dispatches on ACT key presses', () => {
    const manager = makeFakeManager('disconnected');
    const teardown = installHardwareConsoleActionKeys(
      manager as unknown as HardwareConsoleManager,
    );
    expect(manager.rawListenerCount()).toBe(0);

    manager.setStatus('connected');
    expect(manager.rawListenerCount()).toBe(1);

    manager.emitRaw({ m: 'v.oai.hid', p: { k: 'ACT06', act: 1 } });
    expect(dispatched).toContainEqual(
      expect.objectContaining({ type: 'sidebarNav/setShowCreateModal', payload: [true] }),
    );

    teardown();
    expect(manager.rawListenerCount()).toBe(0);
  });

  it('detaches the decoder on disconnect', () => {
    const manager = makeFakeManager('connected');
    const teardown = installHardwareConsoleActionKeys(
      manager as unknown as HardwareConsoleManager,
    );
    expect(manager.rawListenerCount()).toBe(1);

    manager.setStatus('disconnected');
    expect(manager.rawListenerCount()).toBe(0);
    teardown();
  });

  it('ignores agent-key presses and key releases', () => {
    const manager = makeFakeManager('connected');
    const teardown = installHardwareConsoleActionKeys(
      manager as unknown as HardwareConsoleManager,
    );
    manager.emitRaw({ m: 'v.oai.hid', p: { k: 'AG00', act: 1 } });
    manager.emitRaw({ m: 'v.oai.hid', p: { k: 'ACT12', act: 0 } });
    expect(dispatched).toHaveLength(0);
    teardown();
  });

  it('routes keydown/keyup of a PTT-mapped key to start/stop recording', () => {
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'] = normalizeActionMapping([
      'push-to-talk',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
    const manager = makeFakeManager('connected');
    const teardown = installHardwareConsoleActionKeys(
      manager as unknown as HardwareConsoleManager,
    );
    manager.emitRaw({ m: 'v.oai.hid', p: { k: 'ACT06', act: 1 } });
    expect(handleVoiceKeyDown).toHaveBeenCalledTimes(1);
    manager.emitRaw({ m: 'v.oai.hid', p: { k: 'ACT06', act: 0 } });
    expect(handleVoiceKeyUp).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('cancels an in-flight recording on disconnect and on teardown', () => {
    const manager = makeFakeManager('connected');
    const teardown = installHardwareConsoleActionKeys(
      manager as unknown as HardwareConsoleManager,
    );
    manager.setStatus('disconnected');
    expect(cancelPttRecording).toHaveBeenCalledTimes(1);
    teardown();
    expect(cancelPttRecording).toHaveBeenCalledTimes(2);
  });
});

describe('persistence key on the daemon bag', () => {
  it('reads/writes actionMappingByModel via the shared hardwareConsole.state path', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: {
        keyPins: ['ws-1'],
        actionMappingByModel: { 'creator-micro-2': new Array(7).fill('none') },
      },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const next = vi.fn((action) => action);
    const invoke = middleware({} as never)(next);

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateActionMapping',
          payload: [
            {
              'creator-micro-2': new Array(7).fill('none'),
              'codex-micro': [...DEFAULT_ACTION_MAPPINGS['codex-micro']],
            },
          ],
        }),
      );
    });

    invoke({
      type: 'hardwareConsole/setActionKeyMapping',
      payload: ['creator-micro-2', 0, 'stop-agent'],
    });
    await vi.waitFor(() => {
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            keyPins: ['ws-1'],
            actionMappingByModel: mockState.hardwareConsole.actionMappingByModel,
          }),
        },
      ]);
    });
  });

  it.each([
    [
      'oldest (pre-attention) defaults',
      [
        'new-workspace',
        'new-agent',
        'see-spec',
        'switch-window-layouts',
        'cycle-in-progress-agents',
        'cycle-workspace-agents',
        'cycle-unread-agents',
      ],
    ],
    [
      'previous (cycle-workspace) defaults',
      [
        'new-workspace',
        'new-agent',
        'see-spec',
        'switch-window-layouts',
        'cycle-in-progress-agents',
        'cycle-workspace-agents',
        'cycle-attention-agents',
      ],
    ],
    [
      'pre-PTT (row-4 cycling) defaults',
      [
        'new-workspace',
        'new-agent',
        'see-spec',
        'switch-window-layouts',
        'cycle-in-progress-agents',
        'cycle-attention-agents',
        'cycle-unread-agents',
      ],
    ],
  ])('migrates a persisted CM2 mapping equal to the %s and writes it back', async (_label, priorDefaults) => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { actionMappingByModel: { 'creator-micro-2': priorDefaults } },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateActionMapping',
          payload: [
            expect.objectContaining({
              'creator-micro-2': [...DEFAULT_ACTION_MAPPINGS['creator-micro-2']],
            }),
          ],
        }),
      );
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            actionMappingByModel: expect.objectContaining({
              'creator-micro-2': [...DEFAULT_ACTION_MAPPINGS['creator-micro-2']],
            }),
          }),
        },
      ]);
    });
  });

  it('migrates a persisted Codex mapping equal to the pre-PTT defaults and writes it back', async () => {
    const priorDefaults = [
      'cycle-in-progress-agents',
      'cycle-attention-agents',
      'stop-agent',
      'new-workspace',
      'cycle-unread-agents',
      'none',
      'new-agent',
    ];
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { actionMappingByModel: { 'codex-micro': priorDefaults } },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateActionMapping',
          payload: [
            expect.objectContaining({
              'codex-micro': [...DEFAULT_ACTION_MAPPINGS['codex-micro']],
            }),
          ],
        }),
      );
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            actionMappingByModel: expect.objectContaining({
              'codex-micro': [...DEFAULT_ACTION_MAPPINGS['codex-micro']],
            }),
          }),
        },
      ]);
    });
  });

  it('does not write back when the persisted Codex mapping is customized', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { actionMappingByModel: { 'codex-micro': new Array(7).fill('see-spec') } },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydrateActionMapping' }),
      );
    });
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('does not write back when the persisted CM2 mapping is customized', async () => {
    const customized = new Array(7).fill('see-spec');
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { actionMappingByModel: { 'creator-micro-2': customized } },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydrateActionMapping' }),
      );
    });
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('hydrates a legacy flat actionMapping array as the CM2 entry', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { actionMapping: new Array(7).fill('see-spec') },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateActionMapping',
          payload: [
            {
              'creator-micro-2': new Array(7).fill('see-spec'),
              'codex-micro': [...DEFAULT_ACTION_MAPPINGS['codex-micro']],
            },
          ],
        }),
      );
    });
  });

  it('hydrates cycleScopeByFamily with defaults filling missing families', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { cycleScopeByFamily: { 'cycle-in-progress-agents': 'all' } },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: 'hardwareConsole/hydrateCycleScopes',
          payload: [
            {
              'cycle-in-progress-agents': 'all',
              'cycle-attention-agents': 'top-level',
              'cycle-idle-agents': 'top-level',
              'cycle-failed-agents': 'all',
            },
          ],
        }),
      );
    });
  });

  it('persists cycleScopeByFamily via RMW, preserving sibling bag fields', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'] },
    });
    const { createHardwareConsoleActionKeyMiddleware } = await import('../action-key-service');
    const middleware = createHardwareConsoleActionKeyMiddleware();
    const invoke = middleware({} as never)(vi.fn((action) => action));

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydrateCycleScopes' }),
      );
    });

    mockState.hardwareConsole.cycleScopeByFamily = {
      ...mockState.hardwareConsole.cycleScopeByFamily,
      'cycle-attention-agents': 'top-level',
    };
    invoke({
      type: 'hardwareConsole/setCycleScope',
      payload: ['cycle-attention-agents', 'top-level'],
    });
    await vi.waitFor(() => {
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            keyPins: ['ws-1'],
            cycleScopeByFamily: expect.objectContaining({
              'cycle-attention-agents': 'top-level',
            }),
          }),
        },
      ]);
    });
  });
});
