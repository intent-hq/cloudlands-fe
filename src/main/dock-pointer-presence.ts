/**
 * Cursor presence over the dock's interactive regions, derived from main's cursor
 * poll. Chromium does not reliably deliver hover events to the non-activating dock
 * window while another window or app is key, so main reports enter/leave itself.
 */
export interface DockPointerPresence {
  inside: boolean;
  /** Window-local DIP point of the sample. */
  x: number;
  y: number;
  revision: number | undefined;
}

export interface DockPointerPresenceSample {
  inside: boolean;
  x: number;
  y: number;
  revision: number | undefined;
  /** Drag, resize, a hidden window or capture: presence is not hover intent. */
  suppressed: boolean;
}

/** Emits only on transitions; a suppressed sample forgets the state without emitting. */
export function createDockPointerPresenceTracker(emit: (presence: DockPointerPresence) => void) {
  let inside = false;
  return {
    /** Returns true when this sample entered the regions. */
    update(sample: DockPointerPresenceSample): boolean {
      if (sample.suppressed) {
        inside = false;
        return false;
      }
      if (sample.inside === inside) return false;
      inside = sample.inside;
      emit({ inside, x: sample.x, y: sample.y, revision: sample.revision });
      return inside;
    },
    reset(): void {
      inside = false;
    },
  };
}
