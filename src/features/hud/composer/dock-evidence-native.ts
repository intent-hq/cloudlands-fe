import { electronAPI } from '$lib/electron-bridge';
import { detectPlatform } from '$lib/utils/platform-capabilities';
import type {
  DockEvidenceNativeService,
  DockEvidenceNativeEvent,
  DockNativeResult,
  DockEvidenceCapabilities,
  DockClipFile,
} from '$shared/dock-evidence';
import type { DockSpeechCapability, DockSpeechEvent } from '$shared/dock-speech';
import {
  DOCK_EVIDENCE_CHANNELS,
  type DockEvidenceBeginRequest,
  type DockEvidenceBeginResult,
  type DockEvidenceSession,
  type DockEvidencePixelsResult,
  type DockEvidenceControl,
  type DockEvidenceEvent,
  type DockEvidencePrivacyPane,
} from '$shared/dock-evidence-ipc';

type Channel = (typeof DOCK_EVIDENCE_CHANNELS)[keyof typeof DOCK_EVIDENCE_CHANNELS];
type Invoke = (channel: Channel, request: unknown) => Promise<unknown>;
type Subscribe = (listener: (event: DockEvidenceEvent) => void) => () => void;

const nativeInvoke: Invoke = async (channel, request) => {
  if (typeof window === 'undefined' || detectPlatform(window) !== 'electron')
    return { ok: false, error: 'unavailable' };
  return electronAPI().invoke(channel, request);
};

const nativeSubscribe: Subscribe = (listener) => {
  if (typeof window === 'undefined' || detectPlatform(window) !== 'electron') return () => {};
  const api = electronAPI();
  const listenerId = api.on(DOCK_EVIDENCE_CHANNELS.EVENT, listener);
  return () => api.offById(DOCK_EVIDENCE_CHANNELS.EVENT, listenerId);
};

/** One adapter per draft lifetime. Dispose on pair, authority, document or draft replacement. */
export function createDockEvidenceNative(
  scope: DockEvidenceBeginRequest,
  invoke: Invoke = nativeInvoke,
  subscribe: Subscribe = nativeSubscribe,
) {
  const identity = { ...scope };
  let disposed = false;
  let session: DockEvidenceSession | null = null;
  let starting: Promise<DockEvidenceBeginResult> | null = null;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<(event: DockEvidenceNativeEvent) => void>();
  const speechListeners = new Set<(event: { speechId: string; event: DockSpeechEvent }) => void>();
  const capabilities: DockEvidenceCapabilities = {
    capture: typeof window !== 'undefined' && detectPlatform(window) === 'electron',
    annotate: false,
    record: false,
  };

  function connectEvents(): void {
    if (unsubscribe) return;
    unsubscribe = subscribe((event) => {
      if (
        disposed ||
        !session ||
        event.sessionId !== session.sessionId ||
        event.draftId !== identity.draftId ||
        event.workspaceId !== identity.workspaceId ||
        event.agentId !== identity.agentId
      )
        return;
      if (event.kind === 'evidence') for (const listener of listeners) listener(event.event);
      else if (event.kind === 'speech')
        for (const listener of speechListeners)
          listener({ speechId: event.speechId, event: event.event });
    });
  }

  async function begin(): Promise<DockEvidenceBeginResult> {
    if (disposed) return { ok: false, error: 'unavailable' };
    if (session) return { ok: true, value: session };
    if (starting) return starting;
    connectEvents();
    starting = (async (): Promise<DockEvidenceBeginResult> => {
      try {
        const result = (await invoke(
          DOCK_EVIDENCE_CHANNELS.BEGIN,
          identity,
        )) as DockEvidenceBeginResult;
        if (!result.ok) return result;
        if (
          result.value.workspaceId !== identity.workspaceId ||
          result.value.agentId !== identity.agentId ||
          result.value.draftId !== identity.draftId
        )
          return { ok: false, error: 'unavailable' };
        if (disposed) {
          await invoke(DOCK_EVIDENCE_CHANNELS.CANCEL, result.value);
          return { ok: false, error: 'unavailable' };
        }
        session = result.value;
        return result;
      } catch {
        return { ok: false, error: 'transport' };
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function capture(
    requestId: string = crypto.randomUUID(),
  ): Promise<DockEvidencePixelsResult> {
    const started = await begin();
    if (!started.ok) return started;
    if (disposed || session !== started.value) return { ok: false, error: 'unavailable' };
    try {
      const result = (await invoke(DOCK_EVIDENCE_CHANNELS.CAPTURE, {
        ...started.value,
        requestId,
        source: 'capture',
      })) as DockEvidencePixelsResult;
      if (disposed || session !== started.value) return { ok: false, error: 'unavailable' };
      if (
        result.ok &&
        (result.value.sessionId !== session.sessionId ||
          result.value.draftId !== identity.draftId ||
          result.value.workspaceId !== identity.workspaceId ||
          result.value.agentId !== identity.agentId ||
          result.value.requestId !== requestId)
      )
        return { ok: false, error: 'unavailable' };
      return result;
    } catch {
      return { ok: false, error: 'transport' };
    }
  }

  async function cancel(): Promise<void> {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
    listeners.clear();
    speechListeners.clear();
    const previous = session;
    session = null;
    if (previous) {
      try {
        await invoke(DOCK_EVIDENCE_CHANNELS.CANCEL, previous);
      } catch {
        /* Document retirement also releases ownership. */
      }
    }
  }

  async function control<T>(command: DockEvidenceControl): Promise<DockNativeResult<T>> {
    const started = await begin();
    if (!started.ok) return started;
    if (disposed || session !== started.value) return { ok: false, error: 'unavailable' };
    try {
      const result = (await invoke(DOCK_EVIDENCE_CHANNELS.CONTROL, {
        ...started.value,
        control: command,
      })) as DockNativeResult<T>;
      return disposed || session !== started.value ? { ok: false, error: 'unavailable' } : result;
    } catch {
      return { ok: false, error: 'transport' };
    }
  }

  async function command(controlRequest: DockEvidenceControl): Promise<void> {
    const result = await control<void>(controlRequest);
    if (!result.ok) throw new Error(result.error);
  }

  /** Probe only; no screen/microphone access. Install .service after this settles. */
  async function initialize() {
    const result = await control<DockEvidenceCapabilities & { speech: DockSpeechCapability }>({
      action: 'capabilities',
    });
    if (result.ok)
      Object.assign(capabilities, {
        capture: result.value.capture,
        annotate: result.value.annotate,
        record: result.value.record,
      });
    return result;
  }

  const service: DockEvidenceNativeService & {
    releaseClip(clipId: string): Promise<DockNativeResult<void>>;
    reportMarkAcceptance(
      annotationId: string,
      markId: string,
      accepted: boolean,
    ): Promise<DockNativeResult<void>>;
  } = {
    capabilities,
    captureDisplay: async () => {
      const result = await capture();
      return result.ok
        ? { ok: true, value: { ...result.value.pixels, image: result.value.image } }
        : result;
    },
    startAnnotation: (annotation) => {
      // The image identity belongs to `still.imageId`; IPC accepts only pixel fields.
      const still = annotation.still;
      if (!still) return control<void>({ action: 'annotation-start', annotation });
      const { base64, mimeType, width, height, displayScale, capturedAt, hash } = still.pixels;
      return control<void>({
        action: 'annotation-start',
        annotation: {
          ...annotation,
          still: {
            imageId: still.imageId,
            pixels: { base64, mimeType, width, height, displayScale, capturedAt, hash },
          },
        },
      });
    },
    setAnnotationMouse: (annotationId: string) =>
      command({ action: 'annotation-mouse', annotationId }),
    setAnnotationMedia: (media) => command({ action: 'annotation-media', media }),
    setAnnotationTool: (annotationId, tool) =>
      command({ action: 'annotation-tool', annotationId, tool }),
    syncMarks: (annotationId, marks) => command({ action: 'annotation-sync', annotationId, marks }),
    endAnnotation: (annotationId) => command({ action: 'annotation-end', annotationId }),
    reportMarkAcceptance: (annotationId, markId, accepted) =>
      control<void>({
        action: 'annotation-mark-result',
        annotationId,
        markId,
        accepted,
      }),
    startClip: (clipId, options) =>
      control<void>({ action: 'clip-start', clipId, maxMs: options.maxMs }),
    stopClip: (clipId) => control<DockClipFile>({ action: 'clip-stop', clipId }),
    releaseClip: (clipId) => control<void>({ action: 'clip-release', clipId }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    begin,
    initialize,
    capture,
    cancel,
    service,
    openSettings: (pane: DockEvidencePrivacyPane) =>
      control<void>({ action: 'open-settings', pane }),
    /** Probe only: whether element picking has Accessibility trust (never prompts). */
    accessibilityStatus: () => control<{ trusted: boolean }>({ action: 'accessibility-status' }),
    speech: {
      start: (speechId: string, locale?: string) =>
        control<void>({ action: 'speech-start', speechId, locale }),
      stop: (speechId: string) =>
        control<Extract<DockSpeechEvent, { type: 'ended' }>>({ action: 'speech-stop', speechId }),
      mark: (speechId: string, markId: string) =>
        command({ action: 'speech-mark', speechId, markId }),
      subscribe: (listener: (event: { speechId: string; event: DockSpeechEvent }) => void) => {
        speechListeners.add(listener);
        return () => {
          speechListeners.delete(listener);
        };
      },
    },
  };
}
