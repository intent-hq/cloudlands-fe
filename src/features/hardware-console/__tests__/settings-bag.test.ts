import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { persistHardwareConsoleKeyPins } from '../assignment/key-pin-persistence-service';
import { persistHardwareConsoleEnabled } from '../integration-toggle-service';

const request = vi.mocked(backendRequest);
let bag: Record<string, unknown>;

function setting() {
  return {
    path: 'hardwareConsole.state',
    value: { ...bag },
    definition: {
      path: 'hardwareConsole.state',
      label: 'Hardware console state',
      description: 'Persisted hardware preferences',
      category: 'hardwareConsole',
      type: 'object',
      defaultValue: {},
    },
    revision: 1,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  __resetSettingsReadCacheForTests();
  bag = { enabled: true, keyPins: ['old'], promptPickerLimit: 6, futurePreference: { keep: true } };
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.get') return setting();
    if (method === 'settings.update') {
      const { changes } = params as { changes: { path: string; value: Record<string, unknown> }[] };
      bag = changes[0].value;
      return { applied: changes, revision: 2 };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
});

describe('hardware settings bag writes through LiveSettingsClient', () => {
  it('preserves both real field writers when saves start together', async () => {
    await Promise.all([
      persistHardwareConsoleEnabled(false),
      persistHardwareConsoleKeyPins(['new'], ['excluded']),
    ]);
    expect(bag).toEqual({
      enabled: false,
      keyPins: ['new'],
      excludedWorkspaceIds: ['excluded'],
      promptPickerLimit: 6,
      futurePreference: { keep: true },
    });
    expect(request).toHaveBeenCalledWith('settings.get', { path: 'hardwareConsole.state' });
    expect(request).toHaveBeenLastCalledWith('settings.update', {
      changes: [
        {
          path: 'hardwareConsole.state',
          value: {
            enabled: false,
            keyPins: ['new'],
            excludedWorkspaceIds: ['excluded'],
            promptPickerLimit: 6,
            futurePreference: { keep: true },
          },
        },
      ],
    });
  });

  it.each(['settings.get', 'settings.update'])(
    'releases the queue after a failed %s so the next writer preserves the bag',
    async (failedMethod) => {
      const respond = request.getMockImplementation()!;
      let failed = false;
      request.mockImplementation(async (method, params) => {
        if (method === failedMethod && !failed) {
          failed = true;
          throw new Error('daemon unavailable');
        }
        return respond(method, params);
      });
      const outcomes = await Promise.allSettled([
        persistHardwareConsoleEnabled(false),
        persistHardwareConsoleKeyPins(['new'], ['excluded']),
      ]);
      expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
      expect(bag).toEqual({
        enabled: true,
        keyPins: ['new'],
        excludedWorkspaceIds: ['excluded'],
        promptPickerLimit: 6,
        futurePreference: { keep: true },
      });
      await persistHardwareConsoleEnabled(false);
      expect(bag.enabled).toBe(false);
      expect(bag.keyPins).toEqual(['new']);
    },
  );
});
