import type { DockEvidenceClip } from '$shared/dock-evidence';
export interface DockRecordingIndicator {
  workspaceId: string;
  agentId: string;
  clipId: string;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
}
interface Input {
  workspaceId: string | null;
  agentId: string | null;
  authority: string | null;
  nativePairId: string | null;
  evidence: { id: string; clips: readonly DockEvidenceClip[] } | null | undefined;
}
/** No draft scanning: the live native pair and current principal must agree. */
export function ownedDockRecording(
  input: Input,
  currentAuthority: string | null,
): DockRecordingIndicator | null {
  const { workspaceId, agentId, authority, nativePairId, evidence } = input;
  if (!workspaceId || !agentId || !authority || authority !== currentAuthority) return null;
  const pairId = JSON.stringify([workspaceId, agentId]);
  if (nativePairId !== pairId || evidence?.id !== pairId) return null;
  const clip = evidence.clips.find((clip) => clip.status === 'recording');
  if (
    !clip ||
    clip.discarding ||
    !Number.isFinite(clip.startedAt) ||
    !Number.isFinite(clip.pausedMs ?? 0) ||
    (clip.pausedAt != null && !Number.isFinite(clip.pausedAt))
  )
    return null;
  return {
    workspaceId,
    agentId,
    clipId: clip.id,
    startedAt: clip.startedAt,
    pausedAt: clip.pausedAt ?? null,
    pausedMs: clip.pausedMs ?? 0,
  };
}

/** Optional clip identity makes a Stop-only request; legacy toggles retain Start. */
export function recordingToggleIntent(
  currentClipId: string | undefined,
  expectedClipId?: string,
): 'ignore' | 'stop' | 'start' {
  if (expectedClipId !== undefined && currentClipId !== expectedClipId) return 'ignore';
  return currentClipId ? 'stop' : 'start';
}
