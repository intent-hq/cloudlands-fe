/**
 * Synthetic native boundary for the dock composer walkthrough. Everything above
 * the native adapter (controller, sagas, slice, editor, send) is production code;
 * this replaces only the helper process: no screen capture, microphone or
 * recording happens. Pixels are a drawn fake app window, speech is scripted text.
 */
import type {
  DockCapturedPixels,
  DockEvidenceNativeEvent,
  DockEvidenceNativeService,
  DockMarkElement,
  DockMarkGeometry,
  DockMarkTool,
} from '$shared/dock-evidence';
import type { DockSpeechCapability, DockSpeechEvent } from '$shared/dock-speech';
import { SYNTHETIC_ELEMENTS } from './dock-composer-e2e-geometry';
import {
  configureDockNativeFactory,
  type DockNativeAdapter,
} from '$store/renderer/slices/dock-conversation/sagas/dock-native-session-saga';

const SYNTHETIC_SCREEN = { width: 1440, height: 900 } as const;

interface SyntheticNativeLog {
  captures: number;
  annotations: { id: string; tool: DockMarkTool; mode: string; still: boolean }[];
  tools: { id: string; tool: DockMarkTool }[];
  synced: { id: string; marks: number[] }[];
  ended: string[];
  clips: { started: string[]; stopped: string[]; released: string[] };
  speech: { started: string[]; stopped: string[]; marks: string[] };
  markAnswers: { markId: string; accepted: boolean }[];
}

/** A fake app window, drawn once: deterministic pixels for tiles, composites and hashes. */
function drawScreen(): DockCapturedPixels {
  const canvas = document.createElement('canvas');
  canvas.width = SYNTHETIC_SCREEN.width;
  canvas.height = SYNTHETIC_SCREEN.height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e9ebef';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, 64);
  g.fillStyle = '#1f2937';
  g.font = '600 26px system-ui, sans-serif';
  // i18n-ignore (synthetic pixels)
  g.fillText('Synthetic settings', 32, 42);
  const { card, save, cancel } = SYNTHETIC_ELEMENTS;
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  g.fillStyle = '#ffffff';
  g.fillRect(card.x, card.y, card.w, card.h);
  g.shadowColor = 'transparent';
  g.fillStyle = '#111827';
  g.font = '600 30px system-ui, sans-serif';
  // i18n-ignore (synthetic pixels)
  g.fillText('Workspace name', card.x + 40, card.y + 70);
  g.strokeStyle = '#cbd5e1';
  g.lineWidth = 2;
  g.strokeRect(card.x + 40, card.y + 110, card.w - 80, 64);
  g.fillStyle = '#64748b';
  g.font = '24px system-ui, sans-serif';
  // i18n-ignore (synthetic pixels)
  g.fillText('Make workspace navigation feel effortless', card.x + 60, card.y + 152);
  g.fillStyle = '#e5e7eb';
  g.fillRect(cancel.x, cancel.y, cancel.w, cancel.h);
  g.fillStyle = '#2563eb';
  g.fillRect(save.x, save.y, save.w, save.h);
  g.font = '600 22px system-ui, sans-serif';
  g.fillStyle = '#111827';
  // i18n-ignore (synthetic pixels)
  g.fillText('Cancel', cancel.x + 56, cancel.y + 34);
  g.fillStyle = '#ffffff';
  // i18n-ignore (synthetic pixels)
  g.fillText('Save', save.x + 66, save.y + 34);
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  return {
    base64,
    mimeType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    displayScale: 2,
    capturedAt: '2026-10-29T23:30:00.000Z',
  };
}

function createSyntheticNative() {
  const screen = drawScreen();
  const log: SyntheticNativeLog = {
    captures: 0,
    annotations: [],
    tools: [],
    synced: [],
    ended: [],
    clips: { started: [], stopped: [], released: [] },
    speech: { started: [], stopped: [], marks: [] },
    markAnswers: [],
  };
  const evidenceListeners = new Set<(event: DockEvidenceNativeEvent) => void>();
  const speechListeners = new Set<
    (payload: { speechId: string; event: DockSpeechEvent }) => void
  >();
  let session: { id: string; captured: boolean } | null = null;
  // Held annotate starts (the overlay "opening"), released by the test in order.
  let holdCaptures = false;
  const heldCaptures: Array<() => void> = [];
  let holdStarts = false;
  const heldStarts: Array<() => void> = [];
  let clip: { id: string; startedAt: number } | null = null;
  // Held speech stops (the recognizer "finalizing"), released by the test.
  let holdStops = false;
  const heldStops: Array<() => void> = [];
  // Speech runs on a virtual clock so chip placement does not depend on wall time.
  let speech: {
    id: string;
    clock: number;
    words: { text: string; startMs: number; endMs: number }[];
    levels: ReturnType<typeof setInterval>;
  } | null = null;

  const emitSpeech = (event: DockSpeechEvent) => {
    if (!speech) return;
    for (const listener of speechListeners) listener({ speechId: speech.id, event });
  };
  const emitEvidence = (event: DockEvidenceNativeEvent) => {
    for (const listener of evidenceListeners) listener(event);
  };
  const transcript = (isFinal: boolean): DockSpeechEvent => {
    const words = speech?.words ?? [];
    return {
      type: 'transcript',
      utterance: 0,
      revision: (speech?.clock ?? 0) + (isFinal ? 1 : 0),
      isFinal,
      text: words.map((word) => word.text).join(''),
      startMs: words[0]?.startMs ?? 0,
      endMs: isFinal ? (speech?.clock ?? 0) : null,
      segments: words.map((word) => ({ ...word })),
    };
  };

  const service: DockEvidenceNativeService = {
    capabilities: { capture: true, annotate: true, record: true },
    captureDisplay: async () => {
      log.captures += 1;
      if (holdCaptures) await new Promise<void>((resolve) => heldCaptures.push(resolve));
      return { ok: true, value: { ...screen } };
    },
    startAnnotation: async ({ id, tool, mode, still }) => {
      log.annotations.push({ id, tool, mode, still: !!still });
      // Like main: a new start replaces the previous session at once.
      session = { id, captured: !!still };
      if (holdStarts) await new Promise<void>((resolve) => heldStarts.push(resolve));
      // Ended or replaced while opening: the start is refused, as in main.
      if (session?.id !== id) return { ok: false, error: 'unavailable' };
      return { ok: true, value: undefined };
    },
    setAnnotationTool: async (id, tool) => {
      // Production's command() rejects a session native no longer has.
      if (session?.id !== id) throw new Error('unavailable');
      log.tools.push({ id, tool });
    },
    syncMarks: async (id, marks) => {
      log.synced.push({ id, marks: marks.map((mark) => mark.n) });
    },
    endAnnotation: async (id) => {
      log.ended.push(id);
      // Production's command() rejects ending a session native already ended.
      if (session?.id !== id) throw new Error('unavailable');
      session = null;
    },
    startClip: async (clipId) => {
      log.clips.started.push(clipId);
      clip = { id: clipId, startedAt: Date.now() };
      return { ok: true, value: undefined };
    },
    stopClip: async (clipId) => {
      log.clips.stopped.push(clipId);
      const durationMs = clip?.id === clipId ? Date.now() - clip.startedAt : 0;
      clip = null;
      const result = {
        ok: true as const,
        value: {
          sourcePath: `/synthetic/dock-clips/${clipId}.mp4`,
          mimeType: 'video/mp4' as const,
          size: 48_000,
          durationMs,
          hasMicAudio: false,
        },
      };
      emitEvidence({ type: 'clip-ended', clipId, result });
      return result;
    },
    releaseClip: async (clipId) => {
      log.clips.released.push(clipId);
      return { ok: true, value: undefined };
    },
    reportMarkAcceptance: async (_annotationId, markId, accepted) => {
      log.markAnswers.push({ markId, accepted });
      return { ok: true, value: undefined };
    },
    subscribe: (listener) => {
      evidenceListeners.add(listener);
      return () => evidenceListeners.delete(listener);
    },
  };

  const capability: DockSpeechCapability = {
    available: true,
    engine: 'analyzer',
    speech: 'authorized',
    microphone: 'authorized',
    locale: 'en-US',
    onDevice: true,
  } as DockSpeechCapability;

  const adapter = {
    initialize: async () => ({
      ok: true as const,
      value: { capture: true, annotate: true, record: true, speech: capability },
    }),
    cancel: async () => {
      if (speech) clearInterval(speech.levels);
      speech = null;
      session = null;
      clip = null;
    },
    openSettings: async () => ({ ok: true as const, value: undefined }),
    service,
    speech: {
      start: async (speechId: string) => {
        log.speech.started.push(speechId);
        let tick = 0;
        speech = {
          id: speechId,
          clock: 0,
          words: [],
          // Deterministic synthetic input level; no microphone is opened.
          levels: setInterval(() => {
            tick += 1;
            emitSpeech({
              type: 'level',
              elapsedMs: tick * 33,
              level: 0.2 + 0.75 * Math.abs(Math.sin(tick * 0.45) * Math.cos(tick * 0.13)),
            });
          }, 33),
        };
        queueMicrotask(() =>
          emitSpeech({
            type: 'ready',
            sessionId: speechId,
            engine: 'analyzer',
            locale: 'en-US',
            onDevice: true,
            startedAtEpochMs: Date.now(),
          }),
        );
        return { ok: true as const, value: undefined };
      },
      stop: async (speechId: string) => {
        log.speech.stopped.push(speechId);
        if (holdStops) await new Promise<void>((resolve) => heldStops.push(resolve));
        const live = speech;
        if (!live || live.id !== speechId)
          return {
            ok: true as const,
            value: { type: 'ended' as const, reason: 'stopped' as const, elapsedMs: 0 },
          };
        clearInterval(live.levels);
        emitSpeech(transcript(true));
        const ended = { type: 'ended' as const, reason: 'stopped' as const, elapsedMs: live.clock };
        emitSpeech(ended);
        speech = null;
        return { ok: true as const, value: ended };
      },
      mark: async (speechId: string, markId: string) => {
        if (!speech || speech.id !== speechId) return;
        log.speech.marks.push(markId);
        speech.clock += 10;
        emitSpeech({ type: 'mark', markId, elapsedMs: speech.clock });
        speech.clock += 10;
      },
      subscribe: (listener: (payload: { speechId: string; event: DockSpeechEvent }) => void) => {
        speechListeners.add(listener);
        return () => speechListeners.delete(listener);
      },
    },
  };

  return {
    log,
    factory: () => ({ ...adapter, service: { ...service } }) as unknown as DockNativeAdapter,
    holdCaptures(value: boolean) {
      holdCaptures = value;
      if (!value) for (const resolve of heldCaptures.splice(0)) resolve();
    },
    /** One gesture in the open annotate/dictation session; the first carries the session screenshot. */
    gesture(tool: DockMarkTool, geometry: DockMarkGeometry, element: DockMarkElement | null) {
      if (!session) throw new Error('No synthetic annotation session');
      const capture = session.captured ? undefined : { ...screen };
      session.captured = true;
      emitEvidence({
        type: 'mark',
        sessionId: session.id,
        tool,
        geometry,
        element,
        ...(capture ? { capture } : {}),
        ...(clip ? { clipMs: Date.now() - clip.startedAt } : {}),
      });
    },
    /** Interim speech: each word advances the virtual audio clock. */
    say(text: string) {
      if (!speech) throw new Error('No synthetic speech session');
      for (const word of text.match(/\s*\S+/g) ?? []) {
        speech.words.push({ text: word, startMs: speech.clock, endMs: speech.clock + 250 });
        speech.clock += 300;
      }
      emitSpeech(transcript(false));
    },
    get sessionId() {
      return session?.id ?? null;
    },
    /** Hold (true) or resume (false) annotate starts; held starts resolve in order. */
    holdStarts(value: boolean) {
      holdStarts = value;
      if (!value) for (const resolve of heldStarts.splice(0)) resolve();
    },
    /** Hold (true) or release (false) speech stops; a released stop then finalizes. */
    holdSpeechStops(value: boolean) {
      holdStops = value;
      if (!value) for (const resolve of heldStops.splice(0)) resolve();
    },
    /** Native ends the session by itself (overlay X, display change) and says so. */
    endNatively() {
      const id = session?.id;
      if (!id) return;
      session = null;
      emitEvidence({ type: 'annotation-ended', sessionId: id });
    },
    /** Native lost the session but its end event has not arrived yet (a real race). */
    dropSilently() {
      session = null;
    },
  };
}

/** Install a synthetic native for the next dock pair; returns its controls and an uninstall. */
export function installSyntheticNative() {
  const native = createSyntheticNative();
  // The root native-session saga reads the factory when the pair opens.
  configureDockNativeFactory(native.factory);
  return { native, uninstall: () => configureDockNativeFactory(null) };
}
