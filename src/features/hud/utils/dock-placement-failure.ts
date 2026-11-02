import type { DockPlacementFailure } from '$shared/dock-placement';
import { m } from '$shared/paraglide/messages.js';

/** Placement notices name what failed; "Could not open the window." is only for opens. */
export function dockPlacementFailureMessage(
  failure: DockPlacementFailure | boolean | null | undefined,
): string {
  if (failure === 'move') return m.dock_moveFailed_error();
  if (failure === 'resize') return m.dock_resizeFailed_error();
  return m.dock_placementFailed_error();
}
