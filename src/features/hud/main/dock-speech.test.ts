// @vitest-environment node
/**
 * Failure modes covered: `ended` delivered twice, not last, or followed by
 * events; stop never resolving when the helper hangs; a crashed helper
 * reported as success; dispose leaving the microphone process alive; split
 * stdout chunks dropped; missing platform/helper spawning anyway; the probe
 * prompting or misreporting permission.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app' } }));

import type { DockSpeechEvent } from '../../../shared/dock-speech';
import { DOCK_SPEECH_STOP_TIMEOUT_MS, probeDockSpeech, startDockSpeech } from './dock-speech';

class FakeHelper extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  commands: Array<Record<string, unknown>> = [];
  kill = vi.fn((signal: string) => {
    this.signalCode = signal;
    this.emit('exit', null, signal);
    return true;
  });
  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) =>
      chunk
        .split('\n')
        .filter(Boolean)
        .forEach((line) => this.commands.push(JSON.parse(line))),
    );
  }
  emitLine(event: object) {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }
  exit(code: number) {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function launch(options: Partial<Parameters<typeof startDockSpeech>[0]> = {}) {
  const helper = new FakeHelper();
  const events: DockSpeechEvent[] = [];
  const spawn = vi.fn(() => helper as never);
  const handle = startDockSpeech(
    { sessionId: 's1', onEvent: (event) => events.push(event), ...options },
    { platform: 'darwin', helperPath: '/bin/intent-dock-speech', spawn },
  );
  return { helper, events, spawn, handle };
}

afterEach(() => vi.useRealTimers());

describe('startDockSpeech', () => {
  it('starts the session, forwards marks, and resolves stop after finals', async () => {
    const { helper, events, handle, spawn } = launch({ micAudioPath: '/tmp/mic.caf' });
    handle.mark('m-early');
    await flush();
    expect(spawn).toHaveBeenCalledWith('/bin/intent-dock-speech', ['--serve']);
    expect(helper.commands[0]).toEqual({
      cmd: 'start',
      sessionId: 's1',
      silenceMs: 8000,
      micAudioPath: '/tmp/mic.caf',
    });
    expect(helper.commands[1]).toEqual({ cmd: 'mark', markId: 'm-early' });

    const stopped = handle.stop();
    await flush();
    expect(helper.commands.at(-1)).toEqual({ cmd: 'stop' });
    const final = JSON.stringify({
      type: 'transcript',
      utterance: 0,
      revision: 2,
      isFinal: true,
      text: 'hi',
      startMs: 0,
      endMs: 300,
      segments: [{ text: 'hi', startMs: 0, endMs: 300 }],
    });
    helper.stdout.write(final.slice(0, 20));
    helper.stdout.write(
      `${final.slice(20)}\n{"type":"ended","reason":"stopped","elapsedMs":900}\n`,
    );
    helper.emitLine({ type: 'level', elapsedMs: 950, level: 0.4 });
    expect(await stopped).toEqual({ type: 'ended', reason: 'stopped', elapsedMs: 900 });
    await flush();
    expect(events.map((event) => event.type)).toEqual(['transcript', 'ended']);
    handle.mark('m-late');
    helper.exit(0);
    expect(events).toHaveLength(2);
  });

  it('reports an unexpected helper exit as an error before ended', async () => {
    const { helper, events, handle } = launch();
    await flush();
    helper.emitLine({ type: 'state', state: 'listening' });
    await flush();
    helper.exit(1);
    expect((await handle.ended).reason).toBe('error');
    expect(events.at(-2)).toMatchObject({ type: 'error', code: 'helper-exited', fatal: true });
  });

  it('ends a stop that never finalizes as a fatal error, once and last', async () => {
    vi.useFakeTimers();
    const { helper, events, handle } = launch();
    await vi.advanceTimersByTimeAsync(0);
    helper.emitLine({
      type: 'transcript',
      utterance: 0,
      revision: 1,
      isFinal: false,
      text: 'kept words',
      startMs: 0,
      endMs: 600,
      segments: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    const stopped = handle.stop();
    await vi.advanceTimersByTimeAsync(DOCK_SPEECH_STOP_TIMEOUT_MS - 1);
    expect(events.map((event) => event.type)).toEqual(['transcript']);
    await vi.advanceTimersByTimeAsync(1);
    expect(await stopped).toMatchObject({ type: 'ended', reason: 'error' });
    expect(helper.kill).toHaveBeenCalledWith('SIGKILL');
    helper.emitLine({ type: 'ended', reason: 'stopped', elapsedMs: 700 });
    helper.exit(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((event) => event.type)).toEqual(['transcript', 'error', 'ended']);
    expect(events[1]).toEqual({
      type: 'error',
      code: 'recognition-failed',
      message: 'finalization timed out',
      fatal: true,
    });
    expect(events.some((event) => event.type === 'ended' && event.reason === 'stopped')).toBe(
      false,
    );
  });

  it('dispose kills immediately and ends as cancelled once', async () => {
    const { helper, events, handle } = launch();
    await flush();
    handle.dispose();
    handle.dispose();
    expect(helper.kill).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: 'ended', reason: 'cancelled', elapsedMs: 0 }]);
  });

  it('cancel before spawn never starts the microphone', async () => {
    const spawn = vi.fn();
    const handle = startDockSpeech(
      { sessionId: 's', onEvent: () => {} },
      { platform: 'darwin', helperPath: '/bin/x', spawn },
    );
    void handle.cancel();
    expect((await handle.ended).reason).toBe('cancelled');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    [{ platform: 'linux' as const, helperPath: '/bin/x' }, 'unsupported-platform'],
    [{ platform: 'darwin' as const, helperPath: null }, 'helper-missing'],
  ])('fails truthfully without spawning (%o)', async (deps, code) => {
    const spawn = vi.fn();
    const events: DockSpeechEvent[] = [];
    const handle = startDockSpeech(
      { sessionId: 's', onEvent: (e) => events.push(e) },
      { ...deps, spawn },
    );
    await handle.ended;
    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'error', code, message: expect.any(String), fatal: true },
      { type: 'ended', reason: 'error', elapsedMs: 0 },
    ]);
  });
});

describe('probeDockSpeech', () => {
  const probeWith = (stdout: string, locale?: string) => {
    const execFile = vi.fn((_cmd, _args, _opts, callback) => callback(null, stdout));
    return {
      execFile,
      result: probeDockSpeech(locale ? { locale } : {}, {
        platform: 'darwin',
        helperPath: '/bin/x',
        execFile,
      }),
    };
  };

  it('reports an available engine without prompting', async () => {
    const { execFile, result } = probeWith(
      '{"speech":"notDetermined","microphone":"authorized","inputDevice":true,"engine":"analyzer","locale":"en_US","onDevice":true}\n',
    );
    expect(await result).toEqual({
      available: true,
      engine: 'analyzer',
      speech: 'notDetermined',
      microphone: 'authorized',
      locale: 'en_US',
      onDevice: true,
    });
    expect(execFile.mock.calls[0][1]).toEqual(['--probe']);
  });

  it('reports denied permission and unsupported locales as typed reasons', async () => {
    expect(
      (
        await probeWith('{"speech":"authorized","microphone":"denied","engine":"recognizer"}')
          .result
      ).reason,
    ).toBe('microphone-permission-denied');
    const { result, execFile } = probeWith(
      '{"speech":"authorized","microphone":"authorized","engine":null}',
      'xx',
    );
    expect((await result).reason).toBe('locale-unsupported');
    expect(execFile.mock.calls[0][1]).toEqual(['--probe', '--locale', 'xx']);
  });

  it('is unavailable off macOS', async () => {
    expect((await probeDockSpeech({}, { platform: 'win32' })).reason).toBe('unsupported-platform');
  });
});
