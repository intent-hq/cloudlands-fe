import type { PanelLayoutRestoreStatus } from "$store/renderer/slices/panel-layout/panel-layout-types";

/**
 * Milliseconds the empty-layout loading window waits before it gives up on the
 * backend restoring persisted tabs and lets the panel container render its
 * empty state.
 */
export const EMPTY_LAYOUT_LOADING_TIMEOUT_MS = 3000;

export type PanelRenderGateInputs = {
  restoreStatus: PanelLayoutRestoreStatus;
  totalTabs: number;
  /**
   * Whether the layout has already been considered "settled" for the current
   * workspace. Once settled, the container stays rendered even if the user
   * closes the last tab — the empty state renders inside <Panel> without
   * unmounting the whole subtree.
   */
  hasSettled: boolean;
};

/**
 * Pure predicate deciding whether <PanelContainer> should render for a
 * workspace. Kept side-effect free so it can be exercised by unit tests and
 * shared between the Svelte component and any future consumers.
 */
export function shouldRenderPanelContainer(inputs: PanelRenderGateInputs): boolean {
  const { restoreStatus, totalTabs, hasSettled } = inputs;
  if (restoreStatus === "restored" || restoreStatus === "invalid") return true;
  if (restoreStatus === "empty" || restoreStatus === "idle") {
    return totalTabs > 0 || hasSettled;
  }
  return false;
}

/**
 * Whether the layout is considered settled synchronously for the given inputs,
 * i.e. no loading window needs to be waited out. Used to short-circuit the
 * fallback timer when tabs are already present or the backend has resolved.
 */
export function isLayoutSettledNow(
  restoreStatus: PanelLayoutRestoreStatus,
  totalTabs: number,
): boolean {
  if (restoreStatus === "restored" || restoreStatus === "invalid") return true;
  if (restoreStatus === "pending") return false;
  return totalTabs > 0;
}
