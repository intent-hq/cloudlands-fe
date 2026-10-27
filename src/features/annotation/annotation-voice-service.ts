import { VoiceRecorder } from '$features/hardware-console/voice/voice-recorder';
import { transcribeWithOs } from '$features/voice/os-transcription-service';
import { getWorkspaceVocabularyTerms } from '$features/voice/workspace-vocabulary-service';
import { store as appStore } from '$store/renderer/store';
import { addAnnotationTranscript } from './annotation-client';

export type AnnotationVoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';

export interface AnnotationVoiceController {
  readonly status: AnnotationVoiceStatus;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  retry(): Promise<boolean>;
  cancel(): void;
}

interface AnnotationVoiceCallbacks {
  onStatus(status: AnnotationVoiceStatus): void;
  onError(error: unknown): void;
}

interface VoiceSettingsState {
  voiceSettings?: {
    vocabulary?: string[] | null;
    language?: string | null;
    inputDeviceId?: string | null;
  };
}

function contextualStrings(
  userTerms: readonly string[] | null | undefined,
  workspaceTerms: string[],
) {
  const seen = new Set<string>();
  return [...(userTerms ?? []), ...workspaceTerms].filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createAnnotationVoiceController(
  workspaceId: string,
  callbacks: AnnotationVoiceCallbacks,
  sessionStartedAt = Date.now(),
): AnnotationVoiceController {
  let currentStatus: AnnotationVoiceStatus = 'idle';
  let recorder: VoiceRecorder | null = null;
  let failedAudio: Blob | null = null;
  let generation = 0;
  let recordingElapsedMs = 0;
  let disposed = false;
  let completion = Promise.resolve();
  let settleCompletion: (() => void) | null = null;

  function setStatus(status: AnnotationVoiceStatus): void {
    currentStatus = status;
    if (!disposed) callbacks.onStatus(status);
  }

  function beginOperation(): void {
    completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
  }

  function settleOperation(): void {
    settleCompletion?.();
    settleCompletion = null;
  }

  function isCurrent(run: number): boolean {
    return !disposed && generation === run;
  }

  function reportError(run: number, error: unknown): void {
    if (!isCurrent(run)) return;
    recorder = null;
    setStatus('error');
    callbacks.onError(error);
    settleOperation();
  }

  function transcribe(run: number, blob: Blob): void {
    failedAudio = blob;
    setStatus('transcribing');
    void (async () => {
      try {
        const voiceSettings = (appStore.state as VoiceSettingsState).voiceSettings;
        const workspaceTerms = await getWorkspaceVocabularyTerms(workspaceId);
        if (!isCurrent(run)) return;
        const result = await transcribeWithOs(
          blob,
          contextualStrings(voiceSettings?.vocabulary, workspaceTerms),
          voiceSettings?.language?.trim() || undefined,
        );
        if (!isCurrent(run)) return;
        const text = result.text.trim();
        if (text) {
          const seconds = Math.max(0, Math.floor(recordingElapsedMs / 1000));
          const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
          await addAnnotationTranscript(`[${time}] ${text}`, sessionStartedAt);
        }
        if (!isCurrent(run)) return;
        failedAudio = null;
        setStatus('idle');
      } catch (error) {
        reportError(run, error);
      } finally {
        if (isCurrent(run)) settleOperation();
      }
    })();
  }

  async function start(): Promise<boolean> {
    if (disposed || currentStatus === 'requesting' || currentStatus === 'recording') return false;
    if (currentStatus === 'transcribing') {
      await completion;
      return false;
    }
    failedAudio = null;
    const run = ++generation;
    beginOperation();
    setStatus('requesting');
    recordingElapsedMs = Date.now() - sessionStartedAt;
    const voiceSettings = (appStore.state as VoiceSettingsState).voiceSettings;
    recorder = new VoiceRecorder({
      deviceId: voiceSettings?.inputDeviceId,
      onFinished: ({ blob }) => {
        if (!isCurrent(run)) return;
        recorder = null;
        transcribe(run, blob);
      },
      onError: (error) => reportError(run, error),
    });
    try {
      const outcome = await recorder.start();
      if (!isCurrent(run)) return false;
      if (outcome === 'recording') {
        setStatus('recording');
        return true;
      }
      recorder = null;
      if (outcome === 'discarded') {
        setStatus('idle');
        settleOperation();
      }
      return false;
    } catch (error) {
      recorder?.cancel();
      reportError(run, error);
      return false;
    }
  }

  return {
    get status() {
      return currentStatus;
    },
    start,
    async stop() {
      if (disposed) return;
      recorder?.stop();
      await completion;
    },
    async retry() {
      if (disposed || currentStatus !== 'error') return false;
      if (!failedAudio) return start();
      const run = ++generation;
      beginOperation();
      transcribe(run, failedAudio);
      await completion;
      return failedAudio === null;
    },
    cancel() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      recorder?.cancel();
      recorder = null;
      failedAudio = null;
      currentStatus = 'idle';
      settleOperation();
    },
  };
}
