/**
 * Browser access slice: the renderer's view of the main-owned setting.
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */
import type { BrowserAccessState } from '$shared/types/browser-access';

export type BrowserAccessSliceState = {
  /** Main's state, or null until the first read succeeds. */
  current: BrowserAccessState | null;
  /** Requests in flight. */
  pending: number;
  /** The last read or change failed. */
  failed: boolean;
};
