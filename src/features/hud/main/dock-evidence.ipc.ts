import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  systemPreferences,
  webContents,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import {
  DOCK_EVIDENCE_CHANNELS,
  type DockEvidenceControl,
  type DockEvidenceSession,
  type DockEvidenceEvent,
} from '../../../shared/dock-evidence-ipc';
import {
  dockEvidenceSessions,
  dockEvidenceRecorder,
  type DockEvidenceOwner,
  type DockEvidenceContext,
} from './dock-evidence-session';
import {
  getDockPlacementSnapshot,
  getDockVisibleSurfaceBounds,
  getDockVisibleSurfaceRegions,
  getDockWindow,
} from '../../../main/dock-window';
import { isDockAnnotationWindow } from '../../../main/dock-annotation-identity';
import {
  dockAnnotationController,
  setupDockAnnotationIPC,
  watchDockNavigation,
} from './dock-annotation-window';
import { cgWindowIdFromMediaSourceId } from './dock-screen-recorder';
import { startDockSpeech, probeDockSpeech, type DockSpeechHandle } from './dock-speech';
import type { DockNativeResult } from '../../../shared/dock-evidence';
import type { DockSpeechEvent } from '../../../shared/dock-speech';

const id = z.string().min(1).max(512);
const BeginSchema = z.object({ workspaceId: id, agentId: id, draftId: id }).strict();
const SessionSchema = BeginSchema.extend({ sessionId: z.string().uuid() });
const CaptureSchema = SessionSchema.extend({
  requestId: z.string().uuid(),
  source: z.enum(['capture', 'annotate', 'dictation']).optional(),
});

const point = z
  .object({ x: z.number().finite().min(0).max(65536), y: z.number().finite().min(0).max(65536) })
  .strict();
const tool = z.enum(['pick', 'box', 'pen', 'arrow']);
const geometry = z.discriminatedUnion('kind', [
  point.extend({
    kind: z.literal('rect'),
    w: z.number().finite().min(0).max(65536),
    h: z.number().finite().min(0).max(65536),
  }),
  z.object({ kind: z.literal('path'), points: z.array(point).min(1).max(2048) }).strict(),
  z.object({ kind: z.literal('arrow'), from: point, to: point }).strict(),
]);
const pixels = z
  .object({
    base64: z
      .string()
      .min(1)
      .max(42 * 1024 * 1024),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive().max(65536),
    height: z.number().int().positive().max(65536),
    displayScale: z.number().finite().positive().max(16),
    capturedAt: z.string().max(64),
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const controlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capabilities') }).strict(),
  z.object({ action: z.literal('accessibility-status') }).strict(),
  z
    .object({
      action: z.literal('open-settings'),
      pane: z.enum(['screen', 'microphone', 'speech', 'accessibility']),
    })
    .strict(),
  z
    .object({
      action: z.literal('annotation-start'),
      annotation: z
        .object({
          id: z.string().uuid(),
          tool,
          mode: z.enum(['live', 'still', 'dictation']),
          still: z.object({ imageId: id, pixels }).strict().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ action: z.literal('annotation-tool'), annotationId: z.string().uuid(), tool })
    .strict(),
  z
    .object({
      action: z.literal('annotation-sync'),
      annotationId: z.string().uuid(),
      marks: z
        .array(z.object({ n: z.number().int().min(1).max(99), tool, geometry }).strict())
        .max(99),
    })
    .strict(),
  z.object({ action: z.literal('annotation-end'), annotationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('annotation-mouse'), annotationId: z.string().uuid() }).strict(),
  (() => {
    const label = z.string().min(1).max(200);
    const button = {
      label,
      tooltip: label,
      disabled: z.boolean(),
      pending: z.boolean(),
      alert: z.boolean(),
    };
    return z
      .object({
        action: z.literal('annotation-media'),
        media: z
          .object({
            capture: z.object(button).strict(),
            record: z
              .object({
                ...button,
                recording: z.boolean(),
                startedAt: z.number().finite().positive().nullable(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict();
  })(),
  z
    .object({
      action: z.literal('annotation-mark-result'),
      annotationId: z.string().uuid(),
      markId: z.string().min(1).max(128),
      accepted: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('clip-start'),
      clipId: z.string().uuid(),
      maxMs: z.number().int().positive().max(120000),
    })
    .strict(),
  z.object({ action: z.literal('clip-stop'), clipId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('clip-release'), clipId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal('speech-start'),
      speechId: z.string().uuid(),
      locale: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z.object({ action: z.literal('speech-stop'), speechId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('speech-mark'), speechId: z.string().uuid(), markId: id }).strict(),
]);
const ControlSchema = SessionSchema.extend({ control: controlSchema });

interface MediaSession {
  context: DockEvidenceContext;
  annotationId?: string;
  imageSize?: { width: number; height: number };
  clipId?: string;
  clipEnded: boolean;
  speech?: DockSpeechHandle;
  speechReady: boolean;
  speechEnded: boolean;
  speechEpoch: number;
  speechStarted?: Promise<DockNativeResult<void>>;
  cancelSpeechStart?: () => void;
  speechGestures: Map<
    string,
    {
      annotationId: string;
      outcome: 'pending' | 'committed' | 'dropped';
      stamped: boolean;
      emitted: boolean;
      accepted?: boolean;
    }
  >;
  speechEvents: DockSpeechEvent[];
  speechDrainWaiters: Set<() => void>;
  markOffers: Map<string, { annotationId: string; offered: boolean; accepted?: boolean }>;
}

const unavailable = (): DockNativeResult<never> => ({ ok: false, error: 'unavailable' });
const MARK_ACK_TIMEOUT_MS = 2_000;
// Renderer requests a pane, never a URL. No probe or failed operation opens settings.
const PRIVACY_SETTINGS = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
} as const;

const logger = new Logger('DockEvidence');

/**
 * Accessibility trust of this app (element picking needs it). Probing never prompts;
 * only an explicit user action asks macOS to prompt, which also registers the app
 * ("Electron" in dev, "Intent" in release) in Privacy & Security › Accessibility.
 */
let accessibilityPrompted = false;
let lastAccessibilityTrust: boolean | null = null;
function accessibilityTrusted(prompt: boolean): boolean {
  if (process.platform !== 'darwin') return true;
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(prompt);
    // Logged on change: macOS answers for the responsible app (see the picker's
    // 'responsibleApp' log), which for a dev app is the app that launched it.
    if (trusted !== lastAccessibilityTrust || prompt)
      logger.info('Accessibility trust probed in main', { trusted, prompted: prompt });
    // A grant made while running: the next session warms a fresh picker helper.
    if (trusted && lastAccessibilityTrust === false) dockAnnotationController.refreshPicker();
    lastAccessibilityTrust = trusted;
    return trusted;
  } catch {
    return false;
  }
}

/** Helper lifetimes are subordinate to the exact dock document/draft binding. */
function createMediaBinder() {
  const sessions = new Map<string, MediaSession>();
  // Keep replacement starts out until a retired startup's late result is cleaned up.
  let clipStartPending = false;
  const preparingOverlayIds = new Map<number, symbol>();
  let exclusionUpdates: Promise<unknown> = Promise.resolve();
  type Unscoped<T> = T extends DockEvidenceSession ? Omit<T, keyof DockEvidenceSession> : never;
  const send = (state: MediaSession, event: Unscoped<DockEvidenceEvent>) => {
    if (!state.context.isCurrent()) return false;
    try {
      state.context.window.webContents.send(DOCK_EVIDENCE_CHANNELS.EVENT, {
        ...state.context.scope,
        ...event,
      });
      return true;
    } catch {
      /* A document that is closing cannot receive new evidence. */
      return false;
    }
  };
  const speechBlocked = (state: MediaSession) =>
    [...state.speechGestures.values()].some(
      (gesture) =>
        gesture.outcome === 'pending' ||
        (gesture.outcome === 'committed' &&
          (gesture.accepted === undefined ||
            (gesture.accepted && !gesture.stamped && !state.speechEnded))),
    );
  const drainSpeech = (state: MediaSession) => {
    if (speechBlocked(state)) return;
    const speechId = state.speech?.sessionId;
    if (!speechId) return;
    const events = state.speechEvents.splice(0);
    // A helper stamp can arrive after a transcript callback. Publish accepted
    // stamps first so a final utterance cannot commit without its earlier click.
    const marks = events.filter((event) => event.type === 'mark');
    for (const event of [...marks, ...events.filter((event) => event.type !== 'mark')]) {
      if (event.type === 'mark') {
        const gesture = state.speechGestures.get(event.markId);
        if (
          gesture &&
          (gesture.outcome !== 'committed' || gesture.accepted !== true || gesture.emitted)
        )
          continue;
        if (gesture) gesture.emitted = true;
      }
      send(state, { kind: 'speech', speechId, event });
    }
    for (const resolve of state.speechDrainWaiters) resolve();
    state.speechDrainWaiters.clear();
  };
  const excludedIds = (state: MediaSession) => {
    const dockId = cgWindowIdFromMediaSourceId(state.context.window.getMediaSourceId());
    return dockId
      ? [
          ...new Set([
            dockId,
            ...dockAnnotationController.overlayWindowIds(),
            ...preparingOverlayIds.keys(),
          ]),
        ]
      : [];
  };
  dockEvidenceSessions.setCaptureExclusionIds(() => [
    ...new Set([...dockAnnotationController.overlayWindowIds(), ...preparingOverlayIds.keys()]),
  ]);
  const updateExclusions = (state: MediaSession, ids: number[]) => {
    const clipId = state.clipId;
    const result = exclusionUpdates.then(async (): Promise<DockNativeResult<void>> => {
      if (!clipId || state.clipId !== clipId || state.clipEnded || !state.context.isCurrent())
        return unavailable();
      return dockEvidenceRecorder.setExcludedWindows(clipId, ids);
    });
    exclusionUpdates = result.catch(() => undefined);
    return result;
  };
  dockEvidenceRecorder.onEnded((clipId, result) => {
    for (const state of sessions.values())
      if (state.clipId === clipId) {
        state.clipEnded = true;
        send(state, { kind: 'evidence', event: { type: 'clip-ended', clipId, result } });
      }
  });
  dockAnnotationController.onOverlayWindowsChanged(() => {
    // A shown overlay is now supplied by overlayWindowIds; a hidden/destroyed
    // one must no longer reserve an exclusion for a later recording.
    preparingOverlayIds.clear();
    for (const state of sessions.values())
      if (state.clipId && !state.clipEnded && state.context.isCurrent()) {
        const clipId = state.clipId;
        void updateExclusions(state, excludedIds(state)).then((result) => {
          if (
            !result.ok &&
            state.clipId === clipId &&
            !state.clipEnded &&
            state.context.isCurrent()
          )
            void dockEvidenceRecorder.stop(clipId);
        });
      }
  });
  dockAnnotationController.subscribe((event) => {
    for (const state of sessions.values())
      if ('sessionId' in event && event.sessionId === state.annotationId) {
        const offer =
          event.type === 'mark' && event.markId ? state.markOffers.get(event.markId) : undefined;
        if (event.type === 'mark' && event.markId && offer?.annotationId !== event.sessionId)
          continue;
        if (offer) offer.offered = true;
        if (!send(state, { kind: 'evidence', event }) && offer && event.type === 'mark') {
          offer.accepted = false;
          const gesture = event.markId ? state.speechGestures.get(event.markId) : undefined;
          if (gesture) gesture.accepted = false;
          drainSpeech(state);
        }
        if (event.type === 'annotation-ended') state.annotationId = undefined;
      }
  });
  dockAnnotationController.onIssue((issue) => {
    if (
      !['pick', 'target', 'capture'].includes(issue.kind) ||
      !['permission', 'unavailable'].includes(issue.error)
    )
      return;
    for (const state of sessions.values()) {
      if (issue.sessionId !== state.annotationId) continue;
      send(state, {
        kind: 'evidence',
        event: {
          type: 'annotation-issue',
          sessionId: issue.sessionId,
          kind: issue.kind,
          error: issue.error,
        },
      });
    }
  });

  function stateFor(caller: DockEvidenceOwner, scope: DockEvidenceSession): MediaSession | null {
    const context = dockEvidenceSessions.context(caller, scope);
    if (!context) return null;
    const existing = sessions.get(scope.sessionId);
    if (existing) return existing;
    const state: MediaSession = {
      context,
      clipEnded: true,
      speechReady: false,
      speechEnded: true,
      speechEpoch: 0,
      speechGestures: new Map(),
      speechEvents: [],
      speechDrainWaiters: new Set(),
      markOffers: new Map(),
    };
    sessions.set(scope.sessionId, state);
    context.onDispose(() => {
      sessions.delete(scope.sessionId);
      dockAnnotationController.retireResources();
      if (state.clipId) void dockEvidenceRecorder.cancel(state.clipId);
      state.cancelSpeechStart?.();
      state.speechEpoch += 1;
      state.speech?.dispose();
      state.speechEvents.length = 0;
      state.speechGestures.clear();
      state.markOffers.clear();
      for (const resolve of state.speechDrainWaiters) resolve();
      state.speechDrainWaiters.clear();
    });
    return state;
  }

  return async (
    caller: DockEvidenceOwner,
    scope: DockEvidenceSession,
    control: DockEvidenceControl,
  ): Promise<DockNativeResult<unknown>> => {
    const state = stateFor(caller, scope);
    if (!state) return unavailable();
    const current = () => state.context.isCurrent();
    let result: DockNativeResult<unknown>;
    switch (control.action) {
      case 'open-settings':
        if (process.platform !== 'darwin') return unavailable();
        // The person clicked a blocked control: prompt so the app is listed in the pane.
        if (control.pane === 'accessibility' && !accessibilityTrusted(false)) {
          accessibilityPrompted = true;
          accessibilityTrusted(true);
        }
        await shell.openExternal(PRIVACY_SETTINGS[control.pane]);
        result = { ok: true, value: undefined };
        break;
      case 'accessibility-status':
        result = { ok: true, value: { trusted: accessibilityTrusted(false) } };
        break;
      case 'annotation-media':
        // The composer's Screenshot/Record state, mirrored on the annotate tool bar.
        dockAnnotationController.setAnnotationMedia(control.media);
        result = { ok: true, value: undefined };
        break;
      case 'capabilities': {
        const [recording, speech] = await Promise.all([
          dockEvidenceRecorder.capability(),
          probeDockSpeech(),
        ]);
        result = {
          ok: true,
          value: {
            capture: true,
            annotate: recording.supported && recording.stillSupported,
            record: recording.supported,
            speech,
          },
        };
        break;
      }
      case 'annotation-start': {
        // The first explicit pick start without trust prompts once per run; the dictation
        // pick session is implicit (the mic) and never prompts.
        if (
          control.annotation.tool === 'pick' &&
          control.annotation.mode === 'live' &&
          !accessibilityPrompted &&
          !accessibilityTrusted(false)
        ) {
          accessibilityPrompted = true;
          accessibilityTrusted(true);
        }
        if (state.annotationId && state.annotationId !== control.annotation.id)
          await dockAnnotationController.endAnnotation(state.annotationId);
        if (!current()) return unavailable();
        state.annotationId = control.annotation.id;
        state.imageSize = control.annotation.still?.pixels;
        dockAnnotationController.configure({
          watchNavigation: watchAnnotationNavigation,
          backendId: () => (current() ? state.context.backendId : null),
          beforeOverlayShow: async (windowId) => {
            const ownsAnnotation = () => current() && state.annotationId === control.annotation.id;
            if (!ownsAnnotation() || !Number.isSafeInteger(windowId) || windowId <= 0) return false;
            const reservation = Symbol();
            preparingOverlayIds.set(windowId, reservation);
            let accepted = false;
            try {
              if (state.clipId && !state.clipEnded) {
                const result = await updateExclusions(state, excludedIds(state));
                if (!result.ok) return false;
              }
              accepted = ownsAnnotation();
              return accepted;
            } catch {
              return false;
            } finally {
              if (!accepted && preparingOverlayIds.get(windowId) === reservation)
                preparingOverlayIds.delete(windowId);
            }
          },
          dockDisplay: () => dockEvidenceSessions.context(caller, scope)?.display ?? null,
          // The shell and every open popup; the whole window when regions are unknown.
          excludedRects: () => {
            const regions = getDockVisibleSurfaceRegions(state.context.window);
            const bounds = state.context.window.getBounds();
            return regions.length
              ? regions.map((local) => ({ ...local, x: bounds.x + local.x, y: bounds.y + local.y }))
              : [bounds];
          },
          excludedWindowIds: () => excludedIds(state).slice(0, 1),
          permissionDenied: () =>
            process.platform === 'darwin' &&
            systemPreferences.getMediaAccessStatus('screen') === 'denied',
          retired: () => !current(),
          // The painted shell (first published region) and its form, in global DIP.
          dockAnchor: () => {
            const window = state.context.window;
            const shell = getDockVisibleSurfaceBounds(window);
            const snapshot = getDockPlacementSnapshot(window);
            if (!current() || !shell || !snapshot) return null;
            const bounds = window.getBounds();
            return {
              rect: { ...shell, x: bounds.x + shell.x, y: bounds.y + shell.y },
              shape: snapshot.shape,
              ...(snapshot.placement.kind === 'edge' ? { side: snapshot.placement.side } : {}),
            };
          },
          clipMs: () =>
            state.clipId ? (dockEvidenceRecorder.elapsedMs(state.clipId) ?? undefined) : undefined,
          // Annotating while dictating is activity: the mic's silence timer must not
          // end dictation mid-markup (a tool bar click, Done or X included).
          onActivity: () => {
            if (current() && state.speechReady && !state.speechEnded) state.speech?.activity();
          },
          onGestureStart: (annotationId, markId) => {
            if (!current() || state.annotationId !== annotationId || state.markOffers.has(markId))
              return;
            state.markOffers.set(markId, { annotationId, offered: false });
            if (!state.speechReady || !state.speech || state.speechGestures.has(markId)) return;
            state.speechGestures.set(markId, {
              annotationId,
              outcome: 'pending',
              stamped: false,
              emitted: false,
            });
            state.speech.mark(markId);
          },
          onGestureSettled: (annotationId, markId, outcome) => {
            const gesture = state.speechGestures.get(markId);
            if (
              !current() ||
              gesture?.annotationId !== annotationId ||
              gesture.outcome !== 'pending'
            )
              return;
            gesture.outcome = outcome === 'committed' ? 'committed' : 'dropped';
            drainSpeech(state);
          },
          capture: async (display) => {
            if (
              !current() ||
              dockEvidenceSessions.context(caller, scope)?.display.id !== display.id
            )
              return unavailable();
            const captured = await dockEvidenceSessions.capture(caller, {
              ...scope,
              requestId: randomUUID(),
              source: control.annotation.mode === 'dictation' ? 'dictation' : 'annotate',
            });
            if (!captured.ok || !current()) return captured.ok ? unavailable() : captured;
            const value = captured.value;
            state.imageSize = value.pixels;
            return {
              ok: true,
              value: {
                png: Buffer.from(value.pixels.base64, 'base64'),
                ...value.pixels,
                image: value.image,
                pixels: { ...value.pixels, image: value.image },
              },
            };
          },
        });
        result = await dockAnnotationController.startAnnotation(control.annotation);
        if (state.annotationId !== control.annotation.id) return unavailable();
        // A refused start leaves no overlay, so it must not keep owning the screen.
        if (!result.ok) state.annotationId = undefined;
        break;
      }
      case 'annotation-tool':
      case 'annotation-mouse':
      case 'annotation-sync':
      case 'annotation-end': {
        if (state.annotationId !== control.annotationId) return unavailable();
        if (control.action === 'annotation-tool')
          await dockAnnotationController.setAnnotationTool(control.annotationId, control.tool);
        else if (control.action === 'annotation-mouse')
          await dockAnnotationController.setAnnotationMouse(control.annotationId);
        else if (control.action === 'annotation-sync') {
          await dockAnnotationController.syncMarks(control.annotationId, control.marks);
          if (state.clipId && !state.clipEnded && state.imageSize)
            dockEvidenceRecorder.setMarks(
              state.clipId,
              control.marks.map((mark) => ({
                ...mark,
                imageWidth: state.imageSize!.width,
                imageHeight: state.imageSize!.height,
              })),
            );
        } else {
          await dockAnnotationController.endAnnotation(control.annotationId);
          state.annotationId = undefined;
        }
        result = { ok: true, value: undefined };
        break;
      }
      case 'annotation-mark-result': {
        const offer = state.markOffers.get(control.markId);
        if (
          !offer ||
          !offer.offered ||
          offer.annotationId !== control.annotationId ||
          (offer.accepted !== undefined && offer.accepted !== control.accepted)
        )
          return unavailable();
        offer.accepted = control.accepted;
        const gesture = state.speechGestures.get(control.markId);
        if (gesture) gesture.accepted = control.accepted;
        drainSpeech(state);
        result = { ok: true, value: undefined };
        break;
      }
      case 'clip-start': {
        if (clipStartPending) return unavailable();
        if (state.clipId === control.clipId && state.clipEnded) return unavailable();
        if (state.clipId && !state.clipEnded && state.clipId !== control.clipId)
          return unavailable();
        const ids = excludedIds(state);
        const displayId = dockEvidenceSessions.context(caller, scope)?.display.id;
        if (!ids.length || displayId === undefined) return unavailable();
        const previousClip = state.clipEnded ? state.clipId : undefined;
        state.clipId = control.clipId;
        state.clipEnded = false;
        clipStartPending = true;
        try {
          if (previousClip && previousClip !== control.clipId) {
            await dockEvidenceRecorder.cancel(previousClip);
            if (!current()) return unavailable();
          }
          result = await dockEvidenceRecorder.start({
            clipId: control.clipId,
            displayId,
            excludeWindowIds: ids,
            includeMic: state.speechReady,
            maxMs: control.maxMs,
            outputDir: path.join(app.getPath('userData'), 'dock-clips', scope.sessionId),
          });
          if (!current()) {
            // cancel() at retirement may precede helper initialization. Repeat
            // cleanup while new starts are fenced, so it cannot hit a replacement.
            await dockEvidenceRecorder.cancel(control.clipId);
            return unavailable();
          }
        } finally {
          clipStartPending = false;
        }
        if (!result.ok) state.clipEnded = true;
        break;
      }
      case 'clip-stop':
        if (state.clipId !== control.clipId) return unavailable();
        result = await dockEvidenceRecorder.stop(control.clipId);
        state.clipEnded = true;
        break;
      case 'clip-release':
        if (state.clipId !== control.clipId || !state.clipEnded) return unavailable();
        await dockEvidenceRecorder.cancel(control.clipId);
        result = { ok: true, value: undefined };
        break;
      case 'speech-start': {
        if (state.speech?.sessionId === control.speechId && state.speechStarted)
          return state.speechEnded ? unavailable() : state.speechStarted;
        if (state.speech && !state.speechEnded) return unavailable();
        if (state.speechEvents.length || speechBlocked(state)) return unavailable();
        state.speechEnded = false;
        state.speechReady = false;
        state.speechGestures.clear();
        state.speechEvents.length = 0;
        const epoch = ++state.speechEpoch;
        let resolve!: (value: DockNativeResult<void>) => void;
        state.speechStarted = new Promise((done) => {
          resolve = done;
        });
        state.cancelSpeechStart = () => resolve(unavailable());
        let failure: DockNativeResult<void> = unavailable();
        state.speech = startDockSpeech({
          sessionId: control.speechId,
          locale: control.locale,
          silenceMs: 8000,
          maxMs: 120000,
          onEvent: (event) => {
            if (!current() || state.speechEpoch !== epoch) return;
            if (event.type === 'ready') {
              state.speechReady = true;
              resolve({ ok: true, value: undefined });
            }
            if (event.type === 'error' && event.fatal)
              failure = {
                ok: false,
                error: event.code.includes('permission') ? 'permission' : 'failed',
              };
            if (event.type === 'ended') {
              state.speechEnded = true;
              state.speechReady = false;
              resolve(failure);
            }
            if (event.type === 'state' && event.state === 'finalizing') state.speechReady = false;
            if (
              (event.type === 'ready' ||
                event.type === 'ended' ||
                (event.type === 'state' && event.state === 'finalizing')) &&
              state.clipId &&
              !state.clipEnded
            )
              void dockEvidenceRecorder.setMicrophone(state.clipId, state.speechReady);
            if (event.type === 'mark' || event.type === 'transcript' || event.type === 'ended') {
              if (event.type === 'mark') {
                const gesture = state.speechGestures.get(event.markId);
                if (gesture) gesture.stamped = true;
              }
              state.speechEvents.push(event);
              drainSpeech(state);
            } else send(state, { kind: 'speech', speechId: control.speechId, event });
          },
        });
        result = await state.speechStarted;
        break;
      }
      case 'speech-stop': {
        if (state.speech?.sessionId !== control.speechId) return unavailable();
        const ended = await state.speech.stop();
        result =
          ended.reason === 'error' ? { ok: false, error: 'failed' } : { ok: true, value: ended };
        // The stop acknowledgement also fences reference insertion. Gesture
        // cancellation/settlement or document retirement releases this barrier.
        if (speechBlocked(state)) {
          const drained = await new Promise<boolean>((resolve) => {
            const complete = (value: boolean) => {
              clearTimeout(timer);
              state.speechDrainWaiters.delete(released);
              resolve(value);
            };
            const released = () => complete(true);
            const timer = setTimeout(() => complete(false), MARK_ACK_TIMEOUT_MS);
            state.speechDrainWaiters.add(released);
          });
          // Keep unresolved references and known words intact. A later explicit
          // retry can replay the same idempotent model receipt and drain them.
          if (!drained) result = { ok: false, error: 'transport', detail: 'mark-ack-timeout' };
        }
        break;
      }
      case 'speech-mark':
        if (!state.speechReady || state.speech?.sessionId !== control.speechId)
          return unavailable();
        state.speech.mark(control.markId);
        result = { ok: true, value: undefined };
        break;
    }
    return current() ? result : unavailable();
  };
}

function owner(event: IpcMainInvokeEvent): DockEvidenceOwner | null {
  if (
    event.sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  )
    return null;
  return { sender: event.sender, frame: event.senderFrame };
}

/** Navigation observers belong to one active annotation, including future webContents. */
function watchAnnotationNavigation(notify: () => void): () => void {
  const cleanups = new Map<Electron.WebContents, () => void>();
  const watch = (contents: Electron.WebContents) => {
    if (contents.isDestroyed() || cleanups.has(contents)) return;
    const stop = watchDockNavigation(
      contents,
      () => {
        const owner = BrowserWindow.fromWebContents(contents);
        return !!owner && (owner === getDockWindow() || isDockAnnotationWindow(owner));
      },
      notify,
    );
    const cleanup = () => {
      stop();
      contents.removeListener('destroyed', cleanup);
      cleanups.delete(contents);
    };
    cleanups.set(contents, cleanup);
    contents.on('destroyed', cleanup);
  };
  const onCreated = (_event: Electron.Event, contents: Electron.WebContents) => watch(contents);
  app.on('web-contents-created', onCreated);
  for (const contents of webContents.getAllWebContents()) watch(contents);
  return () => {
    app.removeListener('web-contents-created', onCreated);
    for (const cleanup of cleanups.values()) cleanup();
  };
}

/** Exact document identity is checked again by the session before and after awaits. */
export function setupDockEvidenceIPC(): void {
  const control = createMediaBinder();
  setupDockAnnotationIPC();
  ipcMain.handle(DOCK_EVIDENCE_CHANNELS.CONTROL, async (event, request: unknown) => {
    const caller = owner(event);
    const parsed = ControlSchema.safeParse(request);
    if (!caller || !parsed.success) return unavailable();
    try {
      const { control: command, ...scope } = parsed.data;
      return await control(caller, scope, command);
    } catch {
      return { ok: false, error: 'failed' };
    }
  });
  ipcMain.handle(DOCK_EVIDENCE_CHANNELS.BEGIN, (event, request: unknown) => {
    const caller = owner(event);
    const parsed = BeginSchema.safeParse(request);
    if (!caller || !parsed.success) return { ok: false, error: 'unavailable' };
    return dockEvidenceSessions.begin(caller, parsed.data);
  });
  ipcMain.handle(DOCK_EVIDENCE_CHANNELS.CAPTURE, (event, request: unknown) => {
    const caller = owner(event);
    const parsed = CaptureSchema.safeParse(request);
    if (!caller || !parsed.success) return { ok: false, error: 'unavailable' };
    return dockEvidenceSessions.capture(caller, parsed.data);
  });
  ipcMain.handle(DOCK_EVIDENCE_CHANNELS.CANCEL, (event, request: unknown) => {
    const caller = owner(event);
    const parsed = SessionSchema.safeParse(request);
    if (!caller || !parsed.success) return { ok: false, error: 'unavailable' };
    return dockEvidenceSessions.cancel(caller, parsed.data);
  });
}
