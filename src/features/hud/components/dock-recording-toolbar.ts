/**
 * The recording tool bar's pure parts: its keyboard shortcuts and the mic level
 * history the time chip draws as a waveform.
 */
import type { DockMarkTool } from '$shared/dock-evidence';

/** Pointer, then the well: Element selector, Rectangle, Draw, Arrow (spec order). */
export const DOCK_RECORDING_TOOLS: readonly DockMarkTool[] = ['pick', 'box', 'pen', 'arrow'];

export const DOCK_RECORDING_TOOL_KEYS: Record<DockMarkTool | 'pointer', string> = {
  pointer: 'V',
  pick: 'E',
  box: 'R',
  pen: 'D',
  arrow: 'A',
};

export type DockRecordingShortcut =
  | { kind: 'tool'; tool: DockMarkTool | 'pointer' }
  | { kind: 'pause' }
  | { kind: 'done' }
  | { kind: 'escape' };

/** Typing goes to the field, never to a shortcut. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
  );
}

/** V/E/R/D/A select a tool, Space pauses or resumes, Enter is Done, Esc selects Pointer. */
export function dockRecordingShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>,
): DockRecordingShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return null;
  if (event.key === ' ') return { kind: 'pause' };
  if (event.key === 'Enter') return { kind: 'done' };
  if (event.key === 'Escape') return { kind: 'escape' };
  const key = event.key.length === 1 ? event.key.toUpperCase() : '';
  for (const [tool, letter] of Object.entries(DOCK_RECORDING_TOOL_KEYS))
    if (key === letter) return { kind: 'tool', tool: tool as DockMarkTool | 'pointer' };
  return null;
}

/** Bars in the time chip's waveform. */
export const DOCK_RECORDING_WAVE_BARS = 5;

/** The newest levels, oldest first, always `DOCK_RECORDING_WAVE_BARS` long. */
export function pushDockRecordingLevel(history: readonly number[], level: number): number[] {
  const value = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const next = [...history, value].slice(-DOCK_RECORDING_WAVE_BARS);
  while (next.length < DOCK_RECORDING_WAVE_BARS) next.unshift(0);
  return next;
}
