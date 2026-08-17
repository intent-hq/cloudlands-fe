import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { appClient } from '$lib/client';
import {
  parseEnabled,
  persistHardwareConsoleEnabled,
  readHardwareConsoleSettingsBag,
} from '../integration-toggle-service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseEnabled', () => {
  it('treats only an explicit false as disabled', () => {
    expect(parseEnabled(false)).toBe(false);
    expect(parseEnabled(true)).toBe(true);
    expect(parseEnabled(undefined)).toBe(true);
    expect(parseEnabled('nope')).toBe(true);
  });
});

describe('integration-toggle settings helpers', () => {
  it('reads the shared hardwareConsole.state bag', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], enabled: true },
    });
    await expect(readHardwareConsoleSettingsBag()).resolves.toEqual({
      keyPins: ['ws-1'],
      enabled: true,
    });
  });

  it('rejects the persist and does not write when the bag read fails', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(persistHardwareConsoleEnabled(false)).rejects.toThrow('hardwareConsole.state');
    expect(appClient.settings.update).not.toHaveBeenCalled();
  });

  it('persists read-modify-write while preserving sibling fields', async () => {
    (appClient.settings.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'hardwareConsole.state',
      value: { keyPins: ['ws-1'], promptUsage: [], actionMapping: [], enabled: true },
    });
    await persistHardwareConsoleEnabled(false);
    expect(appClient.settings.update).toHaveBeenCalledWith([
      {
        path: 'hardwareConsole.state',
        value: {
          keyPins: ['ws-1'],
          promptUsage: [],
          actionMapping: [],
          enabled: false,
        },
      },
    ]);
  });
});
