import { isTextEntryTarget } from '$lib/utils/text-entry';

/**
 * Pure rules of the recording editor's player and timeline (Capture and recording
 * editor spec, "Video and timeline").
 */

/** One frame at the recording's 30 fps cap. */
export const FRAME_MS = 1000 / 30;
export const STEP_MS = 5000;

/** m:ss, or h:mm:ss from an hour. */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function clampTime(ms: number, durationMs: number): number {
  return Math.min(Math.max(0, ms), Math.max(0, durationMs));
}

/** Where a time sits on the timeline, 0–100. */
export function timelinePercent(ms: number, durationMs: number): number {
  return durationMs > 0 ? (clampTime(ms, durationMs) / durationMs) * 100 : 0;
}

/** The time under a pointer at `x` on a track spanning `left`..`left + width`. */
export function timeAtPointer(x: number, left: number, width: number, durationMs: number): number {
  return width > 0 ? clampTime(((x - left) / width) * durationMs, durationMs) : 0;
}

export type RecordingKeyAction = 'toggle' | 'back' | 'forward' | 'previous-frame' | 'next-frame';

/**
 * Space plays and pauses, J and L step 5 s, comma and period one frame. Never while
 * typing, and never with a modifier (those belong to the shell: save, undo).
 */
export function recordingKeyAction(event: KeyboardEvent): RecordingKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = event.target;
  if (isTextEntryTarget(target)) return null;
  switch (event.key) {
    case ' ':
      return target instanceof HTMLButtonElement ? null : 'toggle';
    case 'j':
    case 'J':
      return 'back';
    case 'l':
    case 'L':
      return 'forward';
    case ',':
      return 'previous-frame';
    case '.':
      return 'next-frame';
    default:
      return null;
  }
}
