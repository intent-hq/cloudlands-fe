import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardwareConsoleManager, HardwareConsoleStatus } from '../../device/device-manager';

const mockState = {
  hardwareConsole: { promptUsage: [] as unknown[], promptPickerLimit: 8 },
};

const storeDispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
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
import {
  createHardwareConsolePromptPickerMiddleware,
  DEFAULT_CENTER_DWELL_MS,
  extractSubmittedPromptText,
  installHardwareConsolePromptPickerJoystick,
} from '../prompt-picker-service';
import {
  radialCancelSector,
  radialPromptTurn,
  radialSectorCount,
  radialSectorForAngle,
  radialSectorOffset,
} from '../radial-layout';
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

function install(prompts: string[], manager = makeFakeManager()) {
  const dispatched: { type: string; payload?: unknown }[] = [];
  const insertText = vi.fn(() => true);
  let time = 0;
  const teardown = installHardwareConsolePromptPickerJoystick(
    manager as unknown as HardwareConsoleManager,
    {
      getTopPrompts: () => prompts,
      dispatch: (action) => dispatched.push(action as { type: string }),
      insertText,
      now: () => time,
    },
  );
  return { manager, dispatched, insertText, teardown, tick: (ms: number) => (time += ms) };
}

const PROMPTS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

beforeEach(() => {
  storeDispatched.length = 0;
  mockState.hardwareConsole = { promptUsage: [], promptPickerLimit: 8 };
  vi.clearAllMocks();
  (appClient.settings.update as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('radial layout', () => {
  it('adds one Cancel sector after the prompt sectors', () => {
    expect(radialSectorCount(8)).toBe(9);
    expect(radialCancelSector(8)).toBe(8);
  });

  it('centers the Cancel sector at 6 o’clock and prompts around the remaining arc', () => {
    // 8 prompts → 9 sectors. Cancel spans screen turns (0.5 ± 1/18).
    expect(radialSectorOffset(8)).toBeCloseTo(-4 / 9);
    expect(radialPromptTurn(0, 8)).toBeCloseTo(-3.5 / 9);
    expect(radialPromptTurn(7, 8)).toBeCloseTo(3.5 / 9);
  });

  // Live-hardware fixtures: the CM2 vendor-mode stream's a=0 points right
  // (3 o'clock) and increases clockwise on screen. With 8 prompts (9
  // sectors), physical down must land on the Cancel sector.
  it.each([
    { device: 0.75, direction: 'up', sector: 4 },
    { device: 0, direction: 'right', sector: 6 },
    { device: 0.25, direction: 'down (Cancel)', sector: 8 },
    { device: 0.5, direction: 'left', sector: 1 },
  ])('maps device angle $device ($direction) to sector $sector', ({ device, sector }) => {
    expect(radialSectorForAngle(device, 8)).toBe(sector);
  });
});

describe('installHardwareConsolePromptPickerJoystick', () => {
  it('opens on deflection past the dead-zone with the pointed sector', () => {
    const { manager, dispatched } = install(PROMPTS);
    manager.joystick(0, 0.1); // inside dead-zone — ignored
    expect(dispatched).toEqual([]);
    manager.joystick(0, 0.9); // device 0 = right
    expect(dispatched).toEqual([radialPromptPickerOpened(PROMPTS, 6)]);
  });

  it('tracks sector changes while deflected', () => {
    const { manager, dispatched } = install(PROMPTS);
    manager.joystick(0, 0.9); // right
    manager.joystick(0.5, 0.9); // left
    expect(dispatched).toEqual([
      radialPromptPickerOpened(PROMPTS, 6),
      radialPromptPickerSectorChanged(1),
    ]);
  });

  it('release on a sector inserts that prompt and closes', () => {
    const { manager, dispatched, insertText } = install(PROMPTS);
    manager.joystick(0, 0.9); // right = sector 6
    manager.joystick(0, 0); // snap back to center = release
    expect(insertText).toHaveBeenCalledExactlyOnceWith('p6');
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('release on the Cancel sector inserts nothing', () => {
    const { manager, dispatched, insertText } = install(PROMPTS);
    manager.joystick(0.25, 0.9); // device 0.25 = down = Cancel
    expect(dispatched).toEqual([radialPromptPickerOpened(PROMPTS, radialCancelSector(8))]);
    manager.joystick(0.25, 0);
    expect(insertText).not.toHaveBeenCalled();
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('release after dwelling centered cancels without inserting', () => {
    const { manager, dispatched, insertText, tick } = install(PROMPTS);
    manager.joystick(0, 0.9);
    manager.joystick(0, 0.25); // below select distance, above release hysteresis
    tick(DEFAULT_CENTER_DWELL_MS + 1);
    manager.joystick(0, 0.25); // dwell elapsed — selection clears
    manager.joystick(0, 0);
    expect(insertText).not.toHaveBeenCalled();
    expect(dispatched.at(-2)).toEqual(radialPromptPickerSectorChanged(null));
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());
  });

  it('a fast snap-back through the hysteresis band still commits', () => {
    const { manager, insertText } = install(PROMPTS);
    manager.joystick(0.5, 0.9); // left = sector 1
    manager.joystick(0.5, 0.25); // passing through — no dwell
    manager.joystick(0.5, 0);
    expect(insertText).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('does not open when there are no tracked prompts', () => {
    const { manager, dispatched } = install([]);
    manager.joystick(0, 0.9);
    expect(dispatched).toEqual([]);
  });

  it('disconnect closes an open session; teardown detaches', () => {
    const { manager, dispatched, teardown } = install(PROMPTS);
    manager.joystick(0, 0.9);
    manager.setStatus('disconnected');
    expect(dispatched.at(-1)).toEqual(radialPromptPickerClosed());

    manager.setStatus('connected');
    teardown();
    const before = dispatched.length;
    manager.joystick(0, 0.9);
    expect(dispatched).toHaveLength(before);
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

describe('createHardwareConsolePromptPickerMiddleware limit persistence', () => {
  it('persists promptPickerLimit read-modify-write, preserving sibling fields', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], promptUsage: [], actionMapping: [], promptPickerLimit: 8 },
    });
    const middleware = createHardwareConsolePromptPickerMiddleware();
    const next = vi.fn((action) => action);
    const invoke = middleware({} as never)(next);

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(storeDispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydratePrompts' }),
      );
    });

    mockState.hardwareConsole.promptPickerLimit = 11;
    invoke({ type: 'hardwareConsole/setPromptPickerLimit', payload: [11] });
    await vi.waitFor(() => {
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            keyPins: ['ws-1'],
            promptUsage: [],
            actionMapping: [],
            promptPickerLimit: 11,
          }),
        },
      ]);
    });
  });
});
