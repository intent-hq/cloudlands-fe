import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
  hardwareConsole: { enabled: true, enabledHydrated: false },
};

const dispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string; payload?: unknown[] }) => {
      dispatched.push(action);
      if (action.type === 'hardwareConsole/hydrateEnabled') {
        mockState.hardwareConsole.enabled = action.payload?.[0] !== false;
        mockState.hardwareConsole.enabledHydrated = true;
      }
      if (action.type === 'hardwareConsole/setEnabled') {
        mockState.hardwareConsole.enabled = action.payload?.[0] === true;
      }
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

const managerStart = vi.fn().mockResolvedValue(undefined);
const managerStop = vi.fn().mockResolvedValue(undefined);

vi.mock('../instance', () => ({
  getHardwareConsoleManager: () => ({ start: managerStart, stop: managerStop }),
}));

import { appClient } from '$lib/client';
import {
  createHardwareConsoleIntegrationToggleMiddleware,
  parseEnabled,
} from '../integration-toggle-service';

beforeEach(() => {
  dispatched.length = 0;
  mockState.hardwareConsole = { enabled: true, enabledHydrated: false };
  vi.clearAllMocks();
});

function invokeChain() {
  const middleware = createHardwareConsoleIntegrationToggleMiddleware();
  const next = vi.fn((action) => action);
  return middleware({} as never)(next);
}

describe('parseEnabled', () => {
  it('treats only an explicit false as disabled', () => {
    expect(parseEnabled(false)).toBe(false);
    expect(parseEnabled(true)).toBe(true);
    expect(parseEnabled(undefined)).toBe(true);
    expect(parseEnabled('nope')).toBe(true);
  });
});

describe('createHardwareConsoleIntegrationToggleMiddleware', () => {
  it('hydrates the enabled flag from the shared hardwareConsole.state bag', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], enabled: true },
    });
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydrateEnabled', payload: [true] }),
      );
    });
    expect(managerStop).not.toHaveBeenCalled();
  });

  it('stops the shared manager when the persisted flag is off', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { enabled: false },
    });
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({ type: 'hardwareConsole/hydrateEnabled', payload: [false] }),
      );
      expect(managerStop).toHaveBeenCalled();
    });
  });

  it('persists toggle changes read-modify-write, preserving sibling fields', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], promptUsage: [], actionMapping: [], enabled: true },
    });
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(mockState.hardwareConsole.enabledHydrated).toBe(true);
    });

    mockState.hardwareConsole.enabled = false;
    invoke({ type: 'hardwareConsole/setEnabled', payload: [false] });
    expect(managerStop).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(appClient.settings.update).toHaveBeenCalledWith([
        {
          path: 'hardwareConsole.state',
          value: expect.objectContaining({
            keyPins: ['ws-1'],
            promptUsage: [],
            actionMapping: [],
            enabled: false,
          }),
        },
      ]);
    });
  });

  it('starts the shared manager when re-enabled', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { enabled: false },
    });
    const invoke = invokeChain();

    invoke({ type: 'any/action' });
    await vi.waitFor(() => {
      expect(mockState.hardwareConsole.enabledHydrated).toBe(true);
    });

    mockState.hardwareConsole.enabled = true;
    invoke({ type: 'hardwareConsole/setEnabled', payload: [true] });
    expect(managerStart).toHaveBeenCalled();
  });
});
