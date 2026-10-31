import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', () => ({
  electronAPI: () => {
    throw new Error('Live transport forbidden');
  },
}));
vi.mock('$lib/utils/platform-capabilities', () => ({ detectPlatform: () => 'browser' }));

import { createDockEvidenceNative } from './dock-evidence-native';
import { DOCK_EVIDENCE_CHANNELS } from '$shared/dock-evidence-ipc';
import type { DockEvidenceEvent } from '$shared/dock-evidence-ipc';

const scope = { workspaceId: 'workspace', agentId: 'agent', draftId: 'draft' };
const session = { ...scope, sessionId: 'session' };
const image = {
  id: 'image',
  contextItemId: 'dock-evidence:image',
  width: 100,
  height: 50,
  displayScale: 2,
  capturedAt: '2026-10-29T00:00:00.000Z',
  source: 'capture' as const,
};
const pixels = {
  base64: 'cG5n',
  mimeType: 'image/png' as const,
  width: 100,
  height: 50,
  displayScale: 2,
  capturedAt: image.capturedAt,
};

describe('dock evidence native adapter', () => {
  it('filters native events by full draft scope and removes the listener on cancellation', async () => {
    let emit!: (event: DockEvidenceEvent) => void;
    const off = vi.fn();
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: undefined },
    );
    const adapter = createDockEvidenceNative(scope, invoke, (listener) => {
      emit = listener;
      return off;
    });
    const received = vi.fn();
    adapter.service.subscribe(received);
    await adapter.begin();
    const payload: DockEvidenceEvent = {
      ...session,
      kind: 'evidence',
      event: { type: 'annotation-ended', sessionId: 'annotation' },
    };
    emit({ ...payload, draftId: 'old' });
    emit({ ...payload, sessionId: 'old' });
    expect(received).not.toHaveBeenCalled();
    emit(payload);
    expect(received).toHaveBeenCalledExactlyOnceWith(payload.event);
    await adapter.cancel();
    emit(payload);
    expect(received).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('preserves typed issue context for the owning draft without triggering a native command', async () => {
    let emit!: (event: DockEvidenceEvent) => void;
    const invoke = vi.fn(async () => ({ ok: true, value: session }));
    const adapter = createDockEvidenceNative(scope, invoke, (listener) => {
      emit = listener;
      return () => {};
    });
    const received = vi.fn();
    adapter.service.subscribe(received);
    await adapter.begin();
    const issue: DockEvidenceEvent = {
      ...session,
      kind: 'evidence',
      event: {
        type: 'annotation-issue',
        sessionId: 'annotation',
        kind: 'pick',
        error: 'permission',
      },
    };
    emit({ ...issue, draftId: 'retired-draft' });
    expect(received).not.toHaveBeenCalled();
    emit(issue);
    expect(received).toHaveBeenCalledExactlyOnceWith(issue.event);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('publishes probed media capabilities before installation and routes scoped controls', async () => {
    const capabilities = {
      capture: true,
      annotate: true,
      record: true,
      speech: { available: true },
    };
    const invoke = vi.fn(async (channel: string, request: any) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: request.control.action === 'capabilities' ? capabilities : undefined },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    expect(await adapter.initialize()).toEqual({ ok: true, value: capabilities });
    expect(adapter.service.capabilities).toEqual({ capture: true, annotate: true, record: true });
    await adapter.service.startAnnotation({ id: 'annotation', mode: 'live', tool: 'box' });
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CONTROL, {
      ...session,
      control: {
        action: 'annotation-start',
        annotation: { id: 'annotation', mode: 'live', tool: 'box' },
      },
    });
  });

  it('requests a bounded privacy pane only when explicitly called and fences disposal', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: undefined },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    await adapter.begin();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await adapter.openSettings('microphone')).toEqual({ ok: true, value: undefined });
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CONTROL, {
      ...session,
      control: { action: 'open-settings', pane: 'microphone' },
    });
    await adapter.cancel();
    const calls = invoke.mock.calls.length;
    expect(await adapter.openSettings('screen')).toEqual({ ok: false, error: 'unavailable' });
    expect(invoke).toHaveBeenCalledTimes(calls);
  });

  it('reports model acceptance with the original native annotation and mark identities', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: undefined },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    expect(await adapter.service.reportMarkAcceptance('annotation', 'mark', false)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CONTROL, {
      ...session,
      control: {
        action: 'annotation-mark-result',
        annotationId: 'annotation',
        markId: 'mark',
        accepted: false,
      },
    });
    await adapter.cancel();
    const count = invoke.mock.calls.length;
    expect(await adapter.service.reportMarkAcceptance('annotation', 'mark', true)).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(invoke).toHaveBeenCalledTimes(count);
  });

  it('preserves a failed speech-stop result instead of claiming finalization succeeded', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: false, error: 'failed' },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    expect(await adapter.speech.stop('speech')).toEqual({ ok: false, error: 'failed' });
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CONTROL, {
      ...session,
      control: { action: 'speech-stop', speechId: 'speech' },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('retains native image identity in the service boundary and never sends blob URLs', async () => {
    const invoke = vi.fn(async (channel: string, request: any) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: { ...session, requestId: request.requestId, image, pixels } },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    expect(await adapter.service.captureDisplay()).toEqual({
      ok: true,
      value: { ...pixels, image },
    });
    expect(invoke.mock.calls[1][1]).toEqual({
      ...session,
      requestId: expect.any(String),
      source: 'capture',
    });
    await adapter.cancel();
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CANCEL, session);
    const calls = invoke.mock.calls.length;
    expect(await adapter.capture()).toEqual({ ok: false, error: 'unavailable' });
    expect(invoke).toHaveBeenCalledTimes(calls);
  });

  it('opens captured still pixels without leaking the model image object into strict IPC', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN
        ? { ok: true, value: session }
        : { ok: true, value: undefined },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    await adapter.service.startAnnotation({
      id: 'annotation',
      tool: 'pen',
      mode: 'still',
      still: { imageId: image.id, pixels: { ...pixels, image } },
    });
    expect(invoke).toHaveBeenLastCalledWith(DOCK_EVIDENCE_CHANNELS.CONTROL, {
      ...session,
      control: {
        action: 'annotation-start',
        annotation: {
          id: 'annotation',
          tool: 'pen',
          mode: 'still',
          still: { imageId: image.id, pixels: { ...pixels, hash: undefined } },
        },
      },
    });
  });

  it('discards bytes after the draft adapter is cancelled', async () => {
    let resolve!: (value: unknown) => void;
    const captured = new Promise((done) => {
      resolve = done;
    });
    const invoke = vi.fn(async (channel: string) => {
      if (channel === DOCK_EVIDENCE_CHANNELS.BEGIN) return { ok: true, value: session };
      if (channel === DOCK_EVIDENCE_CHANNELS.CAPTURE) return captured;
      return { ok: true, value: true };
    });
    const adapter = createDockEvidenceNative(scope, invoke);
    await adapter.begin();
    const pending = adapter.capture('request');
    await Promise.resolve();
    await adapter.cancel();
    resolve({ ok: true, value: { ...session, requestId: 'request', image, pixels } });
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
  });

  it('cancels an accepted begin that arrives after disposal without starting capture', async () => {
    let resolve!: (value: unknown) => void;
    const begun = new Promise((done) => {
      resolve = done;
    });
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.BEGIN ? begun : { ok: true, value: true },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    const pending = adapter.capture('request');
    await adapter.cancel();
    resolve({ ok: true, value: session });
    expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      DOCK_EVIDENCE_CHANNELS.BEGIN,
      DOCK_EVIDENCE_CHANNELS.CANCEL,
    ]);
  });

  it('rejects mismatched receipts and does not claim unsupported live features succeeded', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === DOCK_EVIDENCE_CHANNELS.CONTROL
        ? { ok: false, error: 'unavailable' }
        : channel === DOCK_EVIDENCE_CHANNELS.BEGIN
          ? { ok: true, value: session }
          : {
              ok: true,
              value: { ...session, draftId: 'replacement', requestId: 'request', image, pixels },
            },
    );
    const adapter = createDockEvidenceNative(scope, invoke);
    expect(await adapter.capture('request')).toEqual({ ok: false, error: 'unavailable' });
    expect(
      await adapter.service.startAnnotation({ id: 'annotation', tool: 'pick', mode: 'live' }),
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(await adapter.service.startClip('clip', { includeMic: false, maxMs: 120000 })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(invoke).toHaveBeenCalledTimes(4);
  });
});
