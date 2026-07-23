/**
 * Tests for the capability-gated drop-conflict prompt seam.
 *
 * Regression context: on web the prompt used to call `dialog.message`, whose
 * `dialog:message` invoke was an UNBRIDGED_INVOKE_ALLOWLIST fold to button
 * index 0 — every conflicting drop silently resolved to 'skip' with no user
 * input. The seam must present the in-app dialog on web (waiting for a real
 * choice) and keep the native `dialog.message` IPC on the electron platform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', () => ({
  dialog: { message: vi.fn(async () => 0) },
}));

import { dialog } from '$lib/electron-bridge';
import {
  conflictResolutionFromIndex,
  FILE_CONFLICT_BUTTONS,
  FILE_CONFLICT_TITLE,
  fileConflictMessage,
  promptFileConflict,
  type WebConflictPromptRequest,
} from '../file-conflict-prompt';

const messageMock = vi.mocked(dialog.message);
const originalElectronAPI = (window as any).electronAPI;

/** Install a browser-mock-shaped electronAPI so getPlatform() reports 'web'. */
function setWebPlatform() {
  (window as any).electronAPI = { versions: { electron: '0.0.0-browser' } };
}

/** Install a real-bridge-shaped electronAPI so getPlatform() reports 'electron'. */
function setElectronPlatform() {
  (window as any).electronAPI = { versions: { electron: '35.0.0' } };
}

describe('promptFileConflict', () => {
  beforeEach(() => {
    messageMock.mockClear();
    messageMock.mockResolvedValue(0);
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('regression: on web it waits for a real user choice instead of folding to skip', async () => {
    setWebPlatform();
    let request: WebConflictPromptRequest | null = null;
    let settled = false;

    const promise = promptFileConflict('a.txt', (r) => (request = r)).then((resolution) => {
      settled = true;
      return resolution;
    });

    // Give any (buggy) immediate resolution a chance to land.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(messageMock).not.toHaveBeenCalled();
    expect(request).not.toBeNull();
    expect(request!.fileName).toBe('a.txt');

    request!.resolve(2);
    await expect(promise).resolves.toBe('overwrite');
  });

  it('on web, honors each button index of the in-app dialog', async () => {
    setWebPlatform();
    for (const [index, expected] of [
      [0, 'skip'],
      [1, 'rename'],
      [2, 'overwrite'],
    ] as const) {
      const promise = promptFileConflict('b.txt', (r) => r.resolve(index));
      await expect(promise).resolves.toBe(expected);
    }
    expect(messageMock).not.toHaveBeenCalled();
  });

  it('on electron, keeps the native dialog.message IPC with the same buttons', async () => {
    setElectronPlatform();
    messageMock.mockResolvedValue(1);
    const openWebDialog = vi.fn();

    await expect(promptFileConflict('c.txt', openWebDialog)).resolves.toBe('rename');

    expect(openWebDialog).not.toHaveBeenCalled();
    expect(messageMock).toHaveBeenCalledExactlyOnceWith(fileConflictMessage('c.txt'), {
      title: FILE_CONFLICT_TITLE,
      type: 'warning',
      buttons: [...FILE_CONFLICT_BUTTONS],
    });
  });

  it('maps button indices to resolutions (0=skip, 1=rename, 2=overwrite, unknown=skip)', () => {
    expect(conflictResolutionFromIndex(0)).toBe('skip');
    expect(conflictResolutionFromIndex(1)).toBe('rename');
    expect(conflictResolutionFromIndex(2)).toBe('overwrite');
    expect(conflictResolutionFromIndex(-1)).toBe('skip');
  });
});
