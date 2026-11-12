import { recordingDockClip } from '$shared/dock-evidence';
import { store as appStore } from '../../../store';
import { evidenceOf } from './dock-evidence-saga';

/**
 * Whether the dock still has live input: dictation, a recording, an annotate session,
 * or the composer's own mic (push-to-talk, a transcription in flight). Closing the
 * dock then could unmount it, and its Escape would cancel the recording.
 */
export function dockInputLive(): boolean {
  const dock = appStore.state.dockConversation;
  const evidence =
    dock.workspaceId && dock.agentId ? evidenceOf(dock.workspaceId, dock.agentId) : undefined;
  const hardware = appStore.state.hardwareConsole;
  return (
    !!dock.nativeSpeech.activeId ||
    !!recordingDockClip(evidence) ||
    !!evidence?.annotation ||
    hardware.pttRecording ||
    hardware.voiceTranscribing
  );
}
