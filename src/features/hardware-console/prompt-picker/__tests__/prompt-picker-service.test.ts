import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';

const mockState = {
  hardwareConsole: {
    promptUsage: [] as unknown[],
    promptPickerLimit: 8,
    isConsoleOwner: true,
  },
};

const storeDispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    createSelector: (selector: (state: typeof mockState, ...args: never[]) => unknown) => {
      const readable = (...args: never[]) => selector(mockState, ...args);
      readable.select = (state: typeof mockState, ...args: never[]) => selector(state, ...args);
      readable.effect = (...args: never[]) => select(selector, ...args);
      return readable;
    },
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string }) => {
      storeDispatched.push(action);
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

vi.mock('../../instance', () => ({
  getHardwareConsoleManager: () => ({
    status: 'unavailable',
    connectedDevice: null,
    start: vi.fn().mockResolvedValue(undefined),
    onStatusChange: () => () => {},
    onRawMessage: () => () => {},
  }),
}));

import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  DEFAULT_CENTER_DWELL_MS,
  extractSubmittedPromptText,
  installHardwareConsolePromptPickerJoystick,
  persistHardwareConsolePromptPickerLimit,
  persistHardwareConsolePromptUsage,
} from '../prompt-picker-service';
import { promptPickerSaga } from '$store/renderer/slices/hardware-console/sagas/prompt-picker-saga';
import { RADIAL_CANCEL_SLOT, buildRadialSlots } from '../radial-layout';
import type { ChatSuggestionSource } from '../chat-suggestions';
import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  radialPromptPickerClosed,
  radialPromptPickerOpened,
  radialPromptPickerSectorChanged,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';

function makeFakeManager(initialStatus: HardwareConsoleStatus = 'connected') {
  const statusListeners = new Set<(status: HardwareConsoleStatus) => void>();
  const rawListeners = new Set<(message: unknown) => void>();
  const fake = {
    status: initialStatus,
    connectedDevice: null,
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
    joystick(a: number, d: number) {
      for (const listener of rawListeners) listener({ a, d });
    },
  };
  return fake;
}

function install(
  prompts: string[],
  manager = makeFakeManager(),
  suggestions: { current: ChatSuggestionSource | null } = { current: null },
) {
  const dispatched: { type: string; payload?: unknown }[] = [];
  const insertText = vi.fn(() => true);
  let time = 0;
  const teardown = installHardwareConsolePromptPickerJoystick(
    manager as unknown as HardwareConsoleManager,
    {
      getTopPrompts: () => prompts,
      getSuggestions: () => suggestions.current,
      dispatch: (action) => dispatched.push(action as { type: string }),
      insertText,
      now: () => time,
      keyboardTarget: window,
    },
  );
  installed.push(teardown);
  return { manager, dispatched, insertText, teardown, tick: (ms: number) => (time += ms) };
}

const installed: (() => void)[] = [];
afterEach(() => {
  for (const teardown of installed.splice(0)) teardown();
});

const PROMPTS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const SLOTS = buildRadialSlots([], PROMPTS);
// Device angles (a=0 is 3 o'clock, clockwise).
const UP = 0.75;
const RIGHT = 0;
const DOWN = 0.25;
const LEFT = 0.5;

describe('active radial keyboard alternative', () => {
  it('cancels the service session without letting a later release insert', () => {
    const run = install(PROMPTS);
    run.manager.joystick(0, 1);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape);
    run.manager.joystick(0, 0);
    expect(escape.defaultPrevented).toBe(true);
    expect(run.insertText).not.toHaveBeenCalled();
    expect(run.dispatched.at(-1)).toEqual(radialPromptPickerClosed());
    run.teardown();
  });

  it('arrows through prompt and Cancel sectors without moving editor focus', () => {
    const run = install(PROMPTS);
    run.manager.joystick(RIGHT, 1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(run.dispatched.at(-1)).toEqual(radialPromptPickerSectorChanged(3));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(run.insertText).toHaveBeenCalledExactlyOnceWith('p3');
    run.manager.joystick(0, 0);
    expect(run.insertText).toHaveBeenCalledTimes(1);
    run.teardown();
  });

  it('does not consume unrelated keys or keys after teardown', () => {
    const run = install(PROMPTS);
    run.manager.joystick(0, 1);
    const typing = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    window.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(false);
    run.teardown();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });
});

beforeEach(() => {
  storeDispatched.length = 0;
  mockState.hardwareConsole = { promptUsage: [], promptPickerLimit: 8, isConsoleOwner: true };
  vi.clearAllMocks();
  (appClient.settings.update as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

const runningTasks: Task[] = [];

afterEach(() => {
  for (const task of runningTasks.splice(0)) task.cancel();
});

function invokePromptPickerSaga(manager = makeFakeManager('unavailable')) {
  const channel = stdChannel();
  runningTasks.push(
    runSaga(
      {
        channel,
        dispatch: (action) => appStore.dispatch(action as never),
        getState: () => mockState,
      },
      promptPickerSaga,
      { manager: manager as unknown as HardwareConsoleManager },
    ),
  );
  return (action: { type: string; payload?: unknown }) => {
    appStore.dispatch(action as never);
    channel.put(action);
    return action;
  };
}

describe('installHardwareConsolePromptPickerJoystick', () => {
  it('opens on deflection past the dead-zone with the pointed direction', () => {
    const { manager, dispatched } = install(PROMPTS);
    manager.joystick(RIGHT, 0.1); // inside dead-zone — ignored
    expect(dispatched).toEqual([]);
    manager.joystick(RIGHT, 0.9);
    expect(dispatched).toEqual([radialPromptPickerOpened(SLOTS, 2)]);
  });

  it('tracks direction changes while deflected', () => {
    const { manager, dispatched } = install(PROMPTS);
    manager.joystick(RIGHT, 0.9);
    manager.joystick(LEFT, 0.9);
    expect(dispatched).toEqual([
      radialPromptPickerOpened(SLOTS, 2),
      radialPromptPickerSectorChanged(6),
    ]);
  });

  it('release on a used prompt inserts it and closes', () => {
    const { manager, dispatched, insertText } = install(PROMPTS);
    manager.joystick(LEFT, 0.9); // slot 6 = p5
    manager.joystick(LEFT, 0);
    expect(insertText).toHaveBeenCalledExactlyOnceWith('p5');
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('release on the Cancel direction inserts nothing', () => {
    const { manager, dispatched, insertText } = install(PROMPTS);
    manager.joystick(DOWN, 0.9);
    expect(dispatched).toEqual([radialPromptPickerOpened(SLOTS, RADIAL_CANCEL_SLOT)]);
    manager.joystick(DOWN, 0);
    expect(insertText).not.toHaveBeenCalled();
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('release on an empty direction does nothing', () => {
    const { manager, insertText } = install(['only']);
    manager.joystick(LEFT, 0.9);
    manager.joystick(LEFT, 0);
    expect(insertText).not.toHaveBeenCalled();
  });

  it('release after dwelling centered cancels without inserting', () => {
    const { manager, dispatched, insertText, tick } = install(PROMPTS);
    manager.joystick(RIGHT, 0.9);
    manager.joystick(RIGHT, 0.25); // below select distance, above release hysteresis
    tick(DEFAULT_CENTER_DWELL_MS + 1);
    manager.joystick(RIGHT, 0.25); // dwell elapsed — selection clears
    manager.joystick(RIGHT, 0);
    expect(insertText).not.toHaveBeenCalled();
    expect(dispatched.at(-2)).toEqual(radialPromptPickerSectorChanged(null));
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('a fast snap-back through the hysteresis band still commits', () => {
    const { manager, insertText } = install(PROMPTS);
    manager.joystick(UP, 0.9);
    manager.joystick(UP, 0.25); // passing through — no dwell
    manager.joystick(UP, 0);
    expect(insertText).toHaveBeenCalledExactlyOnceWith('p0');
  });

  it('does not open with no tracked prompts and no chat suggestions', () => {
    const { manager, dispatched } = install([]);
    manager.joystick(RIGHT, 0.9);
    expect(dispatched).toEqual([]);
  });

  it('disconnect closes an open session; teardown detaches', () => {
    const { manager, dispatched, teardown } = install(PROMPTS);
    manager.joystick(RIGHT, 0.9);
    manager.setStatus('disconnected');
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());

    manager.setStatus('connected');
    teardown();
    const before = dispatched.length;
    manager.joystick(RIGHT, 0.9);
    expect(dispatched).toHaveLength(before);
  });
});

describe('chat suggestions on the ring', () => {
  function withSuggestions(prompts: string[], used = ['p0', 'p1']) {
    const source = { prompts, send: vi.fn() };
    const suggestions = { current: source as ChatSuggestionSource | null };
    return { source, suggestions, run: install(used, makeFakeManager(), suggestions) };
  }

  it('opens with the focused chat suggestions at top, top-right and right', () => {
    const { run } = withSuggestions(['s1', 's2', 's3']);
    run.manager.joystick(UP, 0.9);
    expect(run.dispatched).toEqual([
      radialPromptPickerOpened(buildRadialSlots(['s1', 's2', 's3'], ['p0', 'p1']), 0),
    ]);
  });

  it('release on a suggestion sends it right away instead of inserting', () => {
    const { source, run } = withSuggestions(['s1', 's2', 's3']);
    run.manager.joystick(RIGHT, 0.9); // slot 2 = suggestion 3
    run.manager.joystick(RIGHT, 0);
    expect(source.send).toHaveBeenCalledExactlyOnceWith('s3');
    expect(run.insertText).not.toHaveBeenCalled();
  });

  it('Enter on a highlighted suggestion sends it', () => {
    const { source, run } = withSuggestions(['s1']);
    run.manager.joystick(UP, 0.9);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(source.send).toHaveBeenCalledExactlyOnceWith('s1');
  });

  it('does not send when the chat that offered it lost focus mid-gesture', () => {
    const { source, suggestions, run } = withSuggestions(['s1']);
    run.manager.joystick(UP, 0.9);
    suggestions.current = null;
    run.manager.joystick(UP, 0);
    expect(source.send).not.toHaveBeenCalled();
  });

  it('opens with suggestions even when no prompts are tracked', () => {
    const { run } = withSuggestions(['s1'], []);
    run.manager.joystick(UP, 0.9);
    expect(run.dispatched).toEqual([radialPromptPickerOpened(buildRadialSlots(['s1'], []), 0)]);
  });

  it('still inserts used prompts that sit next to suggestions', () => {
    const { source, run } = withSuggestions(['s1', 's2']);
    run.manager.joystick(RIGHT, 0.9); // slot 2 = p0
    run.manager.joystick(RIGHT, 0);
    expect(run.insertText).toHaveBeenCalledExactlyOnceWith('p0');
    expect(source.send).not.toHaveBeenCalled();
  });
});

describe('extractSubmittedPromptText', () => {
  it('extracts the text from a sendMessage action', () => {
    const action = sendMessage('agent-1', { text: 'do the thing', wsId: 'ws-1' });
    expect(extractSubmittedPromptText(action)).toBe('do the thing');
  });

  it('returns null for blank text and unrelated actions', () => {
    expect(extractSubmittedPromptText(sendMessage('a', { text: '  ', wsId: 'w' }))).toBeNull();
    expect(extractSubmittedPromptText({ type: 'other/action', payload: {} })).toBeNull();
    expect(extractSubmittedPromptText(undefined)).toBeNull();
  });
});

describe('promptPickerSaga limit persistence', () => {
  it('persists promptPickerLimit read-modify-write, preserving sibling fields', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], promptUsage: [], actionMapping: [], promptPickerLimit: 8 },
    });
    const invoke = invokePromptPickerSaga();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(storeDispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydratePrompts' }),
      );
    });

    mockState.hardwareConsole.promptPickerLimit = 5;
    invoke({ type: 'hardwareConsole/setPromptPickerLimit', payload: [5] });
    await vi.waitFor(() => {
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            keyPins: ['ws-1'],
            promptUsage: [],
            actionMapping: [],
            promptPickerLimit: 5,
          }),
        },
      ]);
    });
  });
});

describe('prompt persist helpers on a failed bag read', () => {
  it('persistHardwareConsolePromptUsage rejects and does not write', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(persistHardwareConsolePromptUsage([])).rejects.toThrow('hardwareConsole.state');
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('persistHardwareConsolePromptPickerLimit rejects and does not write', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(persistHardwareConsolePromptPickerLimit(8)).rejects.toThrow(
      'hardwareConsole.state',
    );
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('writes the merged bag preserving sibling fields on a successful read', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], enabled: false },
    });
    await persistHardwareConsolePromptUsage([]);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      {
        path: 'hardwareConsole.state',
        value: { keyPins: ['ws-1'], enabled: false, promptUsage: [] },
      },
    ]);
  });
});
