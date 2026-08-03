/**
 * One-time key-slot resolution for toast surfaces: the resolved 0-based slot
 * a workspace occupies on the hardware console, or `null` unless a micro is
 * actually connected (same gate as the workspace-card badge — the manager's
 * `connected` status, not physical presence).
 *
 * Not under `utils/` because it is NOT dependency-light: it reads the shared
 * manager singleton and the app store. Toast services lazy-import this module
 * so they stay light per the middleware conventions in AGENTS.md.
 */
import { getHardwareConsoleManager } from '../instance';
import { store as appStore } from '$store/renderer/store';
import { selectWorkspaceResolvedKeySlot } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

/**
 * Resolved 0-based slot for `workspaceId`, or `null` when no micro is
 * connected, the id is missing, or the workspace holds no slot.
 */
export function resolveConnectedWorkspaceKeySlot(workspaceId: string | undefined): number | null {
  if (!workspaceId) return null;
  if (getHardwareConsoleManager().status !== 'connected') return null;
  return selectWorkspaceResolvedKeySlot.select(appStore.state, workspaceId);
}
