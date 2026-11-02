/**
 * The shared startup-reply classifier and snapshot parser, against the shapes
 * docs/protocol/startup-readiness.md defines.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyStartupReply,
  clampStartupRetryMs,
  parseStartupSnapshot,
  startupErrorShape,
} from './daemon-startup';

const preparing = {
  startupStatus: 1,
  daemonVersion: '0.10.47',
  attemptId: 'boot-a',
  phase: 'preparing',
  elapsedMs: 1200,
  phaseElapsedMs: 1200,
  progressAgeMs: 1200,
  retryAfterMs: 1000,
};
const failedSnapshot = {
  ...preparing,
  phase: 'failed',
  phaseElapsedMs: 0,
  progressAgeMs: 0,
  retryAfterMs: undefined,
  failure: { code: 'startup-failed', message: 'Daemon startup failed. Check daemon logs.' },
};

describe('parseStartupSnapshot', () => {
  it('accepts the documented example and tolerates the indexing fields', () => {
    expect(parseStartupSnapshot(preparing)).toMatchObject({ phase: 'preparing' });
    expect(
      parseStartupSnapshot({
        ...preparing,
        phase: 'indexing',
        estimatedRemainingMs: 5000,
        progress: {
          completedNotes: 1,
          totalNotes: 2,
          processedSourceBytes: 10,
          totalSourceBytes: 20,
        },
      }),
    ).toMatchObject({ phase: 'indexing', progress: { totalNotes: 2 } });
    expect(
      parseStartupSnapshot({ ...preparing, phase: 'finalizing', finalizingStep: 'services' }),
    ).toMatchObject({ finalizingStep: 'services' });
    expect(parseStartupSnapshot(failedSnapshot)).toMatchObject({ phase: 'failed' });
  });

  it.each([
    ['an unknown schema', { ...preparing, startupStatus: 2 }],
    ['a terminal phase with a retry delay', { ...preparing, phase: 'ready' }],
    ['a live phase without a retry delay', { ...preparing, retryAfterMs: undefined }],
    ['finalizing without a step', { ...preparing, phase: 'finalizing' }],
    ['failed without a failure', { ...failedSnapshot, failure: undefined }],
    ['an estimate outside indexing', { ...preparing, estimatedRemainingMs: 10 }],
    [
      'progress past its inventory',
      {
        ...preparing,
        progress: {
          completedNotes: 3,
          totalNotes: 2,
          processedSourceBytes: 0,
          totalSourceBytes: 0,
        },
      },
    ],
    ['a non-object', 99],
  ])('rejects %s', (_label, value) => {
    expect(parseStartupSnapshot(value)).toBeNull();
  });
});

describe('classifyStartupReply', () => {
  it('recognizes daemon-not-ready from a raw error, the main error and the IPC payload', () => {
    const data = {
      code: 'daemon-not-ready',
      retryable: true,
      retryAfterMs: 3000,
      startup: preparing,
    };
    for (const error of [
      { code: -32012, message: 'Daemon not ready', data },
      { rpcCode: -32012, code: 'daemon-not-ready', message: 'Daemon not ready', data },
    ]) {
      expect(classifyStartupReply(error)).toMatchObject({
        kind: 'not-ready',
        retryAfterMs: 3000,
        snapshot: { attemptId: 'boot-a' },
      });
    }
  });

  it('recognizes daemon-startup-failed with the daemon failure message', () => {
    expect(
      classifyStartupReply({
        code: -32012,
        message: 'Daemon startup failed',
        data: { code: 'daemon-startup-failed', retryable: false, startup: failedSnapshot },
      }),
    ).toMatchObject({ kind: 'failed', message: 'Daemon startup failed. Check daemon logs.' });
    expect(
      classifyStartupReply({
        code: -32012,
        message: 'Daemon startup failed',
        data: { code: 'daemon-startup-failed', retryable: false },
      }),
    ).toMatchObject({ kind: 'failed', message: 'Daemon startup failed', snapshot: null });
  });

  it.each([
    ['another code', { code: -32603, data: { code: 'daemon-not-ready', retryable: true } }],
    ['no data', { code: -32012, message: 'Daemon not ready' }],
    ['a non-retryable not-ready', { code: -32012, data: { code: 'daemon-not-ready' } }],
    ['a non-object', 'Daemon not ready'],
  ])('ignores %s', (_label, error) => {
    expect(classifyStartupReply(error)).toBeUndefined();
  });

  it('round-trips the locally built refusal for both postures', () => {
    expect(
      classifyStartupReply(
        startupErrorShape({ state: 'starting', snapshot: null, available: false }),
      ),
    ).toMatchObject({ kind: 'not-ready', retryAfterMs: 1000 });
    expect(
      classifyStartupReply(
        startupErrorShape({ state: 'failed', snapshot: null, available: false, message: 'x' }),
      ),
    ).toMatchObject({ kind: 'failed' });
  });
});

describe('clampStartupRetryMs', () => {
  it.each([
    [undefined, 1000],
    [Number.NaN, 1000],
    [1, 1000],
    [4500, 4500],
    [120_000, 30_000],
  ])('bounds %s to %s', (value, expected) => {
    expect(clampStartupRetryMs(value)).toBe(expected);
  });
});
