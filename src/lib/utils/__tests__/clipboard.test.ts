import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  invoke,
  isElectron,
} from '$lib/electron-bridge';
import { writeTextToClipboard } from '../clipboard';

function setBrowserClipboard(writeText?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

describe('writeTextToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the Electron clipboard IPC when available', async () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue({ success: true });
    const browserWrite = vi.fn().mockResolvedValue(undefined);
    setBrowserClipboard(browserWrite);

    await writeTextToClipboard('https://example.com');

    expect(invoke).toHaveBeenCalledWith('system:write-clipboard', { text: 'https://example.com' });
    expect(browserWrite).not.toHaveBeenCalled();
  });

  it('falls back to the browser clipboard outside Electron', async () => {
    vi.mocked(isElectron).mockReturnValue(false);
    const browserWrite = vi.fn().mockResolvedValue(undefined);
    setBrowserClipboard(browserWrite);

    await writeTextToClipboard('https://example.com/fallback');

    expect(browserWrite).toHaveBeenCalledWith('https://example.com/fallback');
  });

  it('falls back to the browser clipboard if Electron IPC fails', async () => {
    vi.mocked(isElectron).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue(new Error('IPC unavailable'));
    const browserWrite = vi.fn().mockResolvedValue(undefined);
    setBrowserClipboard(browserWrite);

    await writeTextToClipboard('https://example.com/retry');

    expect(browserWrite).toHaveBeenCalledWith('https://example.com/retry');
  });
});