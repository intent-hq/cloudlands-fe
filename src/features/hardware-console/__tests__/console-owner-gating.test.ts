/**
 * Regression coverage for intent-hq/monorepo#1928: with two windows sharing
 * one device stream, only the console-owner window acts on decoded hardware
 * input, and an ownership flip moves handling to the new owner without
 * re-plugging the device. Each "window" is one service install with its own
 * injected `isOwner` gate and per-window seams (navigate/dispatch), all
 * subscribed to the same fake manager — mirroring production where every
 * window's HardwareConsoleManager sees the same raw channel-2 stream.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../device/device-manager';
import { normalizeActionMappingsByModel } from '../actions/action-mapping';
import { normalizeCycleScopeByFamily } from '../actions/cycle-scope';

const mockState = {
  tabState: { currentTabId: 'ws-other' as string | null },
  hardwareConsole: {
    isConsoleOwner: true,
    keyPins: [null, null, null, null, null, null] as (string | null)[],
    excludedWorkspaceIds: [] as string[],
    encoderHudWorkspaceId: null as string | null,
    actionMappingByModel: normalizeActionMappingsByModel(undefined),
    cycleScopeByFamily: normalizeCycleScopeByFamily(undefined),
    promptUsage: [] as unknown[],
    promptPickerLimit: 8,
  },
  workspace: {
    workspaces: createCollection('id', [
      { id: 'ws-1', lastActivity: '2026-08-10T12:00:00Z' } as never,
      { id: 'ws-2', lastActivity: '2026-08-09T12:00:00Z' } as never,
    ]),
  },
  panelLayout: { byWorkspaceId: {} as Record<string, unknown> },
  agentSessions: { byAgentId: {} },
  workspaceAgents: { byWorkspaceId: {} as Record<string, { foregroundAgentIds: string[] }> },
  sidebarNav: {
    panelItem: null as string | null,
    allSpacesViewMode: 'recent',
    multiSelectTabOrder: [],
    multiSelectSelectedTabIdsByWorkspaceId: {},
  },
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
    createSelector: (selector: (state: typeof mockState) => unknown) => ({
      select: (state: typeof mockState) => selector(state),
    }),
  },
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn(), update: vi.fn().mockResolvedValue([]) } },
}));

vi.mock('$lib/utils/navigation.client', () => ({
  navigateToRoute: vi.fn(() => Promise.resolve()),
  isHudWindowRenderer: () => false,
}));

vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: vi.fn() }));

vi.mock('../voice/voice-recorder', () => ({ isVoiceRecordingSupported: vi.fn(() => true) }));

vi.mock('../voice/ptt-controller', () => ({
  handleVoiceKeyDown: vi.fn(),
  handleVoiceKeyUp: vi.fn(),
  cancelPttRecording: vi.fn(),
  isPttRecordingActive: vi.fn(() => false),
}));

import { handleVoiceKeyDown, handleVoiceKeyUp } from '../voice/ptt-controller';
import { installHardwareConsoleKeySwitching } from '../assignment/key-switch-service';
import { installHardwareConsoleEncoder } from '../encoder/encoder-service';
import { installHardwareConsoleActionKeys } from '../actions/action-key-service';
import { installHardwareConsolePromptPickerJoystick } from '../prompt-picker/prompt-picker-service';

function makeFakeManager(initialStatus: HardwareConsoleStatus = 'connected') {
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
    keyDown(k: string) {
      fake.emitRaw({ m: 'v.oai.hid', p: { k, act: 1 } });
    },
    keyUp(k: string) {
      fake.emitRaw({ m: 'v.oai.hid', p: { k, act: 0 } });
    },
    detent(k: 'ENC_CW' | 'ENC_CC') {
      fake.emitRaw({ m: 'v.oai.hid', p: { k, act: 2 } });
    },
  };
  return fake;
}

type FakeManager = ReturnType<typeof makeFakeManager>;
const asManager = (fake: FakeManager) => fake as unknown as HardwareConsoleManager;

/** Mutable ownership switch shared by the two simulated windows. */
let owner: 'A' | 'B' = 'A';
const isOwnerA = () => owner === 'A';
const isOwnerB = () => owner === 'B';

const teardowns: (() => void)[] = [];

beforeEach(() => {
  owner = 'A';
  dispatched.length = 0;
  mockState.hardwareConsole.isConsoleOwner = true;
  mockState.hardwareConsole.keyPins = [null, null, null, null, 'ws-1', null];
  mockState.hardwareConsole.encoderHudWorkspaceId = null;
  mockState.tabState.currentTabId = 'ws-other';
  mockState.sidebarNav.panelItem = null;
  for (const teardown of teardowns.splice(0)) teardown();
  vi.clearAllMocks();
});

describe('agent-key switching (two windows, one owner)', () => {
  it('navigates exactly once, in the owner window', () => {
    const manager = makeFakeManager();
    const navigateA = vi.fn(() => Promise.resolve());
    const navigateB = vi.fn(() => Promise.resolve());
    teardowns.push(
      installHardwareConsoleKeySwitching(asManager(manager), {
        navigate: navigateA,
        isOwner: isOwnerA,
      }),
      installHardwareConsoleKeySwitching(asManager(manager), {
        navigate: navigateB,
        isOwner: isOwnerB,
      }),
    );

    // AG00 = binding slot 4 → pinned 'ws-1'.
    manager.keyDown('AG00');

    expect(navigateA).toHaveBeenCalledTimes(1);
    expect(navigateA).toHaveBeenCalledWith('/workspace/ws-1');
    expect(navigateB).not.toHaveBeenCalled();
  });

  it('moves handling to the new owner mid-session without re-plugging', () => {
    const manager = makeFakeManager();
    const navigateA = vi.fn(() => Promise.resolve());
    const navigateB = vi.fn(() => Promise.resolve());
    teardowns.push(
      installHardwareConsoleKeySwitching(asManager(manager), {
        navigate: navigateA,
        isOwner: isOwnerA,
      }),
      installHardwareConsoleKeySwitching(asManager(manager), {
        navigate: navigateB,
        isOwner: isOwnerB,
      }),
    );

    manager.keyDown('AG00');
    expect(navigateA).toHaveBeenCalledTimes(1);
    expect(navigateB).not.toHaveBeenCalled();

    owner = 'B';
    manager.keyDown('AG00');

    expect(navigateA).toHaveBeenCalledTimes(1);
    expect(navigateB).toHaveBeenCalledTimes(1);
  });
});

describe('encoder (two windows, one owner)', () => {
  it('rotates and clicks only in the owner window', () => {
    const manager = makeFakeManager();
    const navigateA = vi.fn(() => Promise.resolve());
    const navigateB = vi.fn(() => Promise.resolve());
    const dispatchA = vi.fn();
    const dispatchB = vi.fn();
    const getCurrentWorkspaceId = () => 'ws-2';
    mockState.tabState.currentTabId = 'ws-1';
    teardowns.push(
      installHardwareConsoleEncoder(asManager(manager), {
        navigate: navigateA,
        dispatch: dispatchA,
        isOwner: isOwnerA,
        getCurrentWorkspaceId,
      }),
      installHardwareConsoleEncoder(asManager(manager), {
        navigate: navigateB,
        dispatch: dispatchB,
        isOwner: isOwnerB,
        getCurrentWorkspaceId,
      }),
    );
    dispatchA.mockClear();
    dispatchB.mockClear();

    manager.detent('ENC_CW');
    expect(navigateA).toHaveBeenCalledTimes(1);
    expect(navigateA).toHaveBeenCalledWith('/workspace/ws-1');
    expect(dispatchA).toHaveBeenCalledWith(expect.objectContaining({ payload: ['ws-1'] }));
    expect(navigateB).not.toHaveBeenCalled();

    manager.keyDown('ENC_CLK');
    expect(dispatchA.mock.calls.length).toBeGreaterThan(0);
    expect(dispatchB).not.toHaveBeenCalled();

    owner = 'B';
    manager.detent('ENC_CW');
    expect(navigateA).toHaveBeenCalledTimes(1);
    expect(navigateB).toHaveBeenCalledTimes(1);
  });
});

describe('action keys / PTT voice gestures (two windows, one owner)', () => {
  it('starts exactly one voice-key gesture, in the owner window', () => {
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'][0] = 'push-to-talk';
    const manager = makeFakeManager();
    teardowns.push(
      installHardwareConsoleActionKeys(asManager(manager), { isOwner: isOwnerA }),
      installHardwareConsoleActionKeys(asManager(manager), { isOwner: isOwnerB }),
    );

    manager.keyDown('ACT06');
    expect(handleVoiceKeyDown).toHaveBeenCalledTimes(1);
    // Releases are never owner-gated (an in-flight hold must end cleanly),
    // so both windows see the keyup; in production each window has its own
    // ptt-controller singleton and the non-starter's release is a no-op
    // (pressed-key count 0). Here both share the mocked module.
    manager.keyUp('ACT06');
    expect(handleVoiceKeyUp).toHaveBeenCalledTimes(2);
  });

  it('keeps delivering keyups to the window that saw the keydown after an ownership flip', () => {
    // PTT completes in the window that started it: the old owner's keyup
    // handler stays live (release is never owner-gated), the new owner's
    // release stays a no-op because its controller saw no keydown.
    mockState.hardwareConsole.actionMappingByModel['creator-micro-2'][0] = 'push-to-talk';
    const manager = makeFakeManager();
    teardowns.push(
      installHardwareConsoleActionKeys(asManager(manager), { isOwner: isOwnerA }),
      installHardwareConsoleActionKeys(asManager(manager), { isOwner: isOwnerB }),
    );

    manager.keyDown('ACT06');
    expect(handleVoiceKeyDown).toHaveBeenCalledTimes(1);

    owner = 'B';
    manager.keyUp('ACT06');
    // Both windows process the release (production windows have separate
    // module singletons; the non-starter's pressed-key count is 0 → no-op).
    expect(handleVoiceKeyUp).toHaveBeenCalledTimes(2);

    // The next gesture starts in the new owner only — still exactly one.
    manager.keyDown('ACT06');
    expect(handleVoiceKeyDown).toHaveBeenCalledTimes(2);
  });
});

describe('prompt-picker joystick (two windows, one owner)', () => {
  it('opens the radial overlay only in the owner window and follows an ownership flip', () => {
    const dispatchA = vi.fn();
    const dispatchB = vi.fn();
    const manager = makeFakeManager();
    teardowns.push(
      installHardwareConsolePromptPickerJoystick(asManager(manager), {
        getTopPrompts: () => ['p1', 'p2'],
        dispatch: dispatchA,
        isOwner: isOwnerA,
      }),
      installHardwareConsolePromptPickerJoystick(asManager(manager), {
        getTopPrompts: () => ['p1', 'p2'],
        dispatch: dispatchB,
        isOwner: isOwnerB,
      }),
    );

    manager.emitRaw({ a: 0, d: 1 });
    expect(dispatchA).toHaveBeenCalledTimes(1);
    expect(dispatchB).not.toHaveBeenCalled();
    manager.emitRaw({ a: 0, d: 0 });

    owner = 'B';
    manager.emitRaw({ a: 0, d: 1 });
    expect(dispatchB).toHaveBeenCalledTimes(1);
  });

  it('lets an already-open session close cleanly after ownership is lost', () => {
    const dispatchA = vi.fn();
    const manager = makeFakeManager();
    teardowns.push(
      installHardwareConsolePromptPickerJoystick(asManager(manager), {
        getTopPrompts: () => ['p1', 'p2'],
        dispatch: dispatchA,
        isOwner: isOwnerA,
      }),
    );

    manager.emitRaw({ a: 0, d: 1 });
    expect(dispatchA).toHaveBeenCalledTimes(1);

    owner = 'B';
    manager.emitRaw({ a: 0, d: 0 });
    // The in-flight session still closes (dispatches radialPromptPickerClosed).
    expect(dispatchA).toHaveBeenCalledTimes(2);
  });

  it('does not insert a prompt on release after ownership was lost mid-session', () => {
    const insertA = vi.fn().mockReturnValue(true);
    const manager = makeFakeManager();
    teardowns.push(
      installHardwareConsolePromptPickerJoystick(asManager(manager), {
        getTopPrompts: () => ['p1', 'p2'],
        dispatch: vi.fn(),
        insertText: insertA,
        isOwner: isOwnerA,
      }),
    );

    // Owner engages on a prompt sector, then focus moves to another window.
    manager.emitRaw({ a: 0, d: 1 });
    owner = 'B';
    manager.emitRaw({ a: 0, d: 0 });
    expect(insertA).not.toHaveBeenCalled();

    // Regaining ownership restores normal release insertion.
    owner = 'A';
    manager.emitRaw({ a: 0, d: 1 });
    manager.emitRaw({ a: 0, d: 0 });
    expect(insertA).toHaveBeenCalledTimes(1);
  });
});
