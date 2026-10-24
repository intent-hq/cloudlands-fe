import {
  cancelPttRecording,
  getActivePttSessionToken,
  startPttRecording,
  stopPttRecording,
  type PttContext,
} from '$features/hardware-console/voice/ptt-controller';
import { isVoiceRecordingSupported } from '$features/hardware-console/voice/voice-recorder';
import { runTranscriptionFlow } from '$features/hardware-console/voice/transcription-service';
import { hasActiveTranscriptionSession } from '$features/hardware-console/voice/transcription-cancellation';
import {
  pttRecordingFinished,
  pttRecordingStopped,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { m } from '$shared/paraglide/messages.js';

/** One controller per mounted discussion composer; shared recorder and engine routing. */
export function createDiscussionMicrophone(options: {
  workspaceId: string;
  context: PttContext;
  isActive: () => boolean;
  onTranscript: (text: string) => void;
  onState: (state: 'idle' | 'recording' | 'transcribing') => void;
}) {
  let ownedSession: object | null = null;
  let generation = 0;
  let cancelTranscription: (() => void) | undefined;
  function cancel() {
    generation++;
    if (ownedSession && ownedSession === getActivePttSessionToken())
      cancelPttRecording(options.context);
    ownedSession = null;
    cancelTranscription?.();
    cancelTranscription = undefined;
    options.onState('idle');
  }
  function toggle() {
    if (!options.isActive()) {
      cancel();
      return;
    }
    if (cancelTranscription) {
      cancel();
      return;
    }
    if (ownedSession && ownedSession === getActivePttSessionToken()) {
      stopPttRecording();
      return;
    }
    if (getActivePttSessionToken() || hasActiveTranscriptionSession()) {
      options.context.showHint(m.chat_richInput_micBusy_message());
      return;
    }
    if (!isVoiceRecordingSupported()) {
      options.context.showHint(m.hardwareConsole_ptt_unavailable_message());
      return;
    }
    const attempt = ++generation;
    const active = () => generation === attempt && options.isActive();
    options.onState('recording');
    startPttRecording({
      showHint: options.context.showHint,
      dispatch(action) {
        const typed = action as { type: string };
        if (typed.type === pttRecordingFinished.type) {
          if (!active()) return;
          ownedSession = null;
          options.onState('transcribing');
          const [recording] = (action as ReturnType<typeof pttRecordingFinished>).payload;
          void runTranscriptionFlow(recording, {
            target: {
              workspaceId: options.workspaceId,
              isActive: active,
              insertText: (text) => {
                if (active()) options.onTranscript(text);
              },
              onStarted: (callback) => {
                cancelTranscription = callback;
              },
              onFinished: () => {
                if (!active()) return;
                cancelTranscription = undefined;
                options.onState('idle');
              },
            },
          })
            .catch(() => {
              if (active())
                options.context.showHint(m.hardwareConsole_voice_transcribeFailed_error());
            })
            .finally(() => {
              if (!active()) return;
              cancelTranscription = undefined;
              options.onState('idle');
            });
          return;
        }
        options.context.dispatch(action);
        if (typed.type === pttRecordingStopped.type && active()) options.onState('idle');
      },
    });
    ownedSession = getActivePttSessionToken();
    if (!ownedSession) options.onState('idle');
  }
  return { toggle, cancel };
}
