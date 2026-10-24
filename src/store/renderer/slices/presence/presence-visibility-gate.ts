/**
 * Window visibility as presence reports it, separated from capture-induced
 * visibility.
 *
 * An agent screenshot of an embedded browser tab keeps the app window
 * drawing while it is minimized or covered, which makes the app document
 * report `visible` for the duration of the capture. Presence must not read
 * that as the user being back: main announces the capture (`active: true`)
 * before it changes anything and again (`active: false`) after it restored
 * the window, so while a capture is active document visibility changes are
 * ignored and the real state is re-read once it ends.
 */

export interface PresenceVisibilityGate {
  /** Visibility presence last reported. */
  readonly reported: boolean;
  /** A capture is keeping the window drawing. */
  readonly captureActive: boolean;
}

export type PresenceVisibilityEvent =
  | { kind: 'document'; visible: boolean }
  | { kind: 'capture'; active: boolean; documentVisible: boolean };

/** Apply one event; `report` is the visibility to publish, or null for none. */
export function applyPresenceVisibilityEvent(
  gate: PresenceVisibilityGate,
  event: PresenceVisibilityEvent,
): { gate: PresenceVisibilityGate; report: boolean | null } {
  if (event.kind === 'capture') {
    if (event.active) return { gate: { ...gate, captureActive: true }, report: null };
    const next = { reported: event.documentVisible, captureActive: false };
    return {
      gate: next,
      report: event.documentVisible === gate.reported ? null : event.documentVisible,
    };
  }
  if (gate.captureActive || event.visible === gate.reported) return { gate, report: null };
  return { gate: { ...gate, reported: event.visible }, report: event.visible };
}
