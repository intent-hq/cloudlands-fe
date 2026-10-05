import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import type { NoteCommitReceipt } from '$lib/client/note-pages';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';
import { validateNoteStagedCanonicalEffects } from './note-staged-canonical-effects';
import bytes from './fixtures/staged-canonical-effects.capture.txt?raw';

interface Capture {
  clock: string;
  base: string;
  input: string;
  final: string;
  baseLength: number;
  inputLength: number;
  finalLength: number;
  receipt: NoteCommitReceipt;
  transcript: {
    method: string;
    params: Record<string, unknown>;
    response: Record<string, unknown>;
  }[];
}
const capture = JSON.parse(bytes) as Capture;
const rpc = vi.mocked(backendRequest);
afterEach(() => vi.restoreAllMocks());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
function setup(held = false) {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(capture.clock));
  let state = a.initialNotePagesState,
    present = true,
    index = 0;
  const listeners = new Set<() => void>();
  const port = {
    read: () => state,
    dispatch(action: Parameters<typeof a.notePagesReducer>[1]) {
      state = a.notePagesReducer(state, action);
      for (const f of [...listeners]) f();
    },
    subscribe(f: () => void) {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  port.dispatch(
    a.pageResourceLimitsConfigured({
      payloadBytes: 10_000_000,
      stringUnits: 10_000_000,
      objectNodes: 1_000_000,
      physicalReads: 1,
      assemblies: 1,
      domNodes: 0,
    }),
  );
  const io = deferred(),
    entered = deferred();
  rpc.mockReset();
  rpc.mockImplementation(async (method, params) => {
    const frame = capture.transcript[index++];
    expect({ method, params }).toEqual({ method: frame.method, params: frame.params });
    expect(params).not.toHaveProperty('payloadDigest');
    expect(state.resourceLedger.used.physicalReads).toBe(1);
    expect(state.resourceLedger.used.payloadBytes).toBeGreaterThan(2_000_000);
    if (held && frame.params.kind === 'detail') {
      entered.resolve();
      await io.promise;
    }
    // Return the original Store object, with no envelope/identity/deadline rewrite.
    return frame.response;
  });
  const abort = new AbortController();
  const run = async () => {
    const lease = reserveNoteReceiptTranscript(
      port,
      new LiveNotePagesClient(),
      capture.receipt,
      capture.baseLength,
      () => present,
      abort.signal,
      Date.now,
      262144,
    );
    try {
      const transcript = await lease.ready;
      return await validateNoteStagedCanonicalEffects(
        new LiveNotePagesClient(),
        capture.receipt,
        capture.baseLength,
        capture.inputLength,
        transcript,
        () => {
          if (!transcript.current()) throw new Error('Lost canonical owner');
        },
      );
    } finally {
      await lease.release();
    }
  };
  return {
    run,
    port,
    io,
    entered,
    abort,
    count: () => index,
    lose() {
      present = false;
      for (const f of [...listeners]) f();
      present = true;
      for (const f of [...listeners]) f();
    },
    clean() {
      expect(state.resourceLedger.used.payloadBytes).toBe(0);
      expect(state.resourceLedger.used.physicalReads).toBe(0);
      expect(listeners.size).toBe(0);
    },
  };
}
it('replays actual staged Store effects and retained scalar pages with exact original requests', async () => {
  expect(capture.base.length).toBe(capture.baseLength);
  expect(capture.input.length).toBe(capture.inputLength);
  expect(capture.final.length).toBe(capture.finalLength);
  expect(new Set([capture.baseLength, capture.inputLength, capture.finalLength]).size).toBe(3);
  const f = setup();
  await expect(f.run()).resolves.toEqual({
    kind: 'validatedCanonicalEffects',
    sourceEffects: 2,
    convertedCount: 0,
    createdTasks: 0,
    inputLength: capture.inputLength,
    outputLength: capture.finalLength,
  });
  expect(f.count()).toBe(capture.transcript.length);
  expect(
    capture.transcript.filter((v) =>
      (v.response.items as { kind?: string }[]).some((item) => item.kind === 'fragment'),
    ).length,
  ).toBeGreaterThan(1);
  f.clean();
});
it.each(['loss', 'cancel'])(
  'retains actual Store detail IO debt through %s and refuses revival',
  async (mode) => {
    const f = setup(true),
      run = f.run(),
      observed = expect(run).rejects.toThrow();
    try {
      await vi.waitFor(() => expect(f.count()).toBe(2), { timeout: 3000 });
      if (mode === 'cancel') f.abort.abort();
      else f.lose();
      expect(f.port.read().resourceLedger.used.physicalReads).toBe(1);
      expect(f.port.read().resourceLedger.used.payloadBytes).toBeGreaterThan(0);
    } finally {
      f.io.resolve();
    }
    await observed;
    expect(f.count()).toBe(2);
    f.clean();
  },
);
