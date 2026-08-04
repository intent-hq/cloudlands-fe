/**
 * Tests for the local OS transcription main-process module: helper spawn
 * argv (temp WAV path + contextual strings), success/error JSON parsing,
 * typed error codes, platform/helper gating, and temp-file cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFile, mockFs } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockFs: {
    access: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock(import('child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual, execFile: mockExecFile };
  return { ...patched, default: patched };
});

vi.mock('fs/promises', () => ({ ...mockFs, default: mockFs }));

// Dev launches run the bundled main from dist/main, so appPath is two
// levels below the project root (see resolveHelperPath).
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/fake/project/dist/main' },
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { VOICE_CHANNELS } from '../../../../shared/ipc/channels';
import {
  registerVoiceLocalHandlers,
  requestOsSpeechAuthorization,
  transcribeWithOsHelper,
} from '../voice-local.ipc';

/** [1,2,3] encodes to "AQID" in standard padded base64. */
const AUDIO_BASE64 = 'AQID';

/** Stub the helper process: capture argv, return canned stdout/exit code. */
function stubHelper(stdout: string, exitCode = 0) {
  mockExecFile.mockImplementation(
    (
      _path: string,
      _args: string[],
      _options: unknown,
      callback: (error: (Error & { code?: number }) | null, stdout: string) => void,
    ) => {
      if (exitCode === 0) {
        callback(null, stdout);
      } else {
        const error = new Error(`exit ${exitCode}`) as Error & { code?: number };
        error.code = exitCode;
        callback(error, stdout);
      }
    },
  );
}

const originalPlatform = process.platform;

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform });
}

beforeEach(() => {
  setPlatform('darwin');
  // The helper existence probe reads resolveHelperPath() via fs.access.
  mockFs.access.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
});

afterEach(() => {
  setPlatform(originalPlatform);
  mockExecFile.mockReset();
  mockFs.access.mockReset();
  mockFs.writeFile.mockReset();
  mockFs.unlink.mockReset();
});

describe('transcribeWithOsHelper', () => {
  it('spawns the helper with the temp file and contextual strings, returns the transcript', async () => {
    stubHelper(JSON.stringify({ text: 'hello world', durationMs: 950 }));

    const result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav', ['intentd']);

    expect(result).toEqual({ success: true, text: 'hello world', durationMs: 950 });
    const [helperPath, args] = mockExecFile.mock.calls[0];
    expect(helperPath).toContain('intent-speech-helper');
    expect(args[0]).toMatch(/intent-dictation-.*\.wav$/);
    expect(args.slice(1)).toEqual(['--contextual-strings', JSON.stringify(['intentd'])]);
    // The decoded audio bytes were written to the temp file passed to the helper.
    expect(mockFs.writeFile).toHaveBeenCalledWith(args[0], Buffer.from([1, 2, 3]));
    expect(mockFs.unlink).toHaveBeenCalledWith(args[0]);
  });

  it('omits --contextual-strings without keyterms', async () => {
    stubHelper(JSON.stringify({ text: '', durationMs: 100 }));

    await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toHaveLength(1);
  });

  it('maps a helper error payload to its typed code', async () => {
    stubHelper(JSON.stringify({ error: 'authorization-denied', message: 'status: 1' }), 1);

    const result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');

    expect(result).toEqual({
      success: false,
      error: { code: 'authorization-denied', message: 'status: 1' },
    });
  });

  it('folds unknown helper error codes and unparseable output to recognition-failed', async () => {
    stubHelper(JSON.stringify({ error: 'novel-code', message: 'boom' }), 1);
    let result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');
    expect(result).toMatchObject({ success: false, error: { code: 'recognition-failed' } });

    stubHelper('not json at all', 1);
    result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');
    expect(result).toMatchObject({ success: false, error: { code: 'recognition-failed' } });
  });

  it('reports unsupported-platform off macOS without spawning', async () => {
    setPlatform('linux');
    const result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');
    expect(result).toMatchObject({ success: false, error: { code: 'unsupported-platform' } });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('reports helper-missing when the binary is absent', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));
    const result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');
    expect(result).toMatchObject({ success: false, error: { code: 'helper-missing' } });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('resolves the dev helper from the project root, two levels above appPath', async () => {
    stubHelper(JSON.stringify({ text: 'ok', durationMs: 1 }));

    await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');

    expect(mockFs.access).toHaveBeenCalledWith(
      '/fake/project/resources/speech-helper/intent-speech-helper',
    );
    const [helperPath] = mockExecFile.mock.calls[0];
    expect(helperPath).toBe('/fake/project/resources/speech-helper/intent-speech-helper');
  });

  it('falls back to the appPath-relative helper when the root staging dir is missing', async () => {
    mockFs.access.mockImplementation((target: unknown) =>
      String(target).startsWith('/fake/project/dist/main/')
        ? Promise.resolve(undefined)
        : Promise.reject(new Error('ENOENT')),
    );
    stubHelper(JSON.stringify({ text: 'ok', durationMs: 1 }));

    await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');

    const [helperPath] = mockExecFile.mock.calls[0];
    expect(helperPath).toBe('/fake/project/dist/main/resources/speech-helper/intent-speech-helper');
  });

  it('cleans up the temp file when the helper crashes', async () => {
    mockExecFile.mockImplementation(
      (
        _path: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => callback(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), ''),
    );

    const result = await transcribeWithOsHelper(AUDIO_BASE64, 'audio/wav');

    expect(result).toMatchObject({ success: false, error: { code: 'recognition-failed' } });
    expect(mockFs.unlink).toHaveBeenCalled();
  });
});

describe('voice:local-available handler', () => {
  /** Register the handlers and return the wrapper bound to the given channel. */
  function captureHandler(channel: string) {
    const handleMock = vi.mocked(ipcMain.handle);
    handleMock.mockClear();
    registerVoiceLocalHandlers();
    const entry = handleMock.mock.calls.find(([registered]) => registered === channel);
    if (!entry) throw new Error(`no handler registered for ${channel}`);
    return entry[1] as (event: unknown, data: unknown) => Promise<unknown>;
  }

  it('reports availability via a pure fs probe — never spawns the helper', async () => {
    const handler = captureHandler(VOICE_CHANNELS.LOCAL_AVAILABLE);

    const result = await handler({}, {});

    expect(result).toEqual({ success: true, available: true });
    expect(mockFs.access).toHaveBeenCalled();
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('reports unavailable when the helper binary is absent — still no spawn', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));
    const handler = captureHandler(VOICE_CHANNELS.LOCAL_AVAILABLE);

    const result = await handler({}, {});

    expect(result).toEqual({ success: true, available: false });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('reports unavailable off macOS without touching the filesystem or spawning', async () => {
    setPlatform('linux');
    const handler = captureHandler(VOICE_CHANNELS.LOCAL_AVAILABLE);

    const result = await handler({}, {});

    expect(result).toEqual({ success: true, available: false });
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('requestOsSpeechAuthorization', () => {
  it('spawns the helper in --request-authorization mode and returns the status', async () => {
    stubHelper(JSON.stringify({ status: 'authorized' }));

    const result = await requestOsSpeechAuthorization();

    expect(result).toEqual({ success: true, status: 'authorized' });
    const [helperPath, args] = mockExecFile.mock.calls[0];
    expect(helperPath).toContain('intent-speech-helper');
    expect(args).toEqual(['--request-authorization']);
    // Authorization mode touches no audio — no temp file is written.
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('passes through denied/restricted/notDetermined statuses', async () => {
    for (const status of ['denied', 'restricted', 'notDetermined']) {
      stubHelper(JSON.stringify({ status }));
      await expect(requestOsSpeechAuthorization()).resolves.toEqual({ success: true, status });
    }
  });

  it('reports unsupported-platform off macOS without spawning', async () => {
    setPlatform('linux');
    const result = await requestOsSpeechAuthorization();
    expect(result).toMatchObject({ success: false, error: { code: 'unsupported-platform' } });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('reports helper-missing when the binary is absent without spawning', async () => {
    mockFs.access.mockRejectedValue(new Error('ENOENT'));
    const result = await requestOsSpeechAuthorization();
    expect(result).toMatchObject({ success: false, error: { code: 'helper-missing' } });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('folds unparseable output and unknown statuses to authorization-failed', async () => {
    stubHelper('not json');
    let result = await requestOsSpeechAuthorization();
    expect(result).toMatchObject({ success: false, error: { code: 'authorization-failed' } });

    stubHelper(JSON.stringify({ status: 'novel-status' }));
    result = await requestOsSpeechAuthorization();
    expect(result).toMatchObject({ success: false, error: { code: 'authorization-failed' } });
  });

  it('folds a helper crash (signal kill, no exit code) to authorization-failed', async () => {
    mockExecFile.mockImplementation(
      (
        _path: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => callback(Object.assign(new Error('killed'), { signal: 'SIGABRT' }), ''),
    );

    const result = await requestOsSpeechAuthorization();

    expect(result).toMatchObject({ success: false, error: { code: 'authorization-failed' } });
  });
});
