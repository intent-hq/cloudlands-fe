import type { ImmediateMotionConfig } from '$lib/motion';
import { store as appStore } from '$store/renderer/store';
import { findWorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
import {
  selectWorkspaceTabGroups,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { resize } from './size-transition';
import { workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';

export { prepareTabOutros } from './workspace-tab-lifecycle-motion';

type LifecycleOptions = Parameters<typeof workspaceTabLifecycleMotion>[1];

/**
 * True when a strip item appears or disappears because a group expands or
 * collapses (or a chip comes or goes), not because a tab opens or closes.
 */
function isGroupToggle(node: HTMLElement, phase: LifecycleOptions['phase']): boolean {
  const workspaceId = node.dataset.workspaceTabMotion;
  if (!workspaceId) return true;
  const state = appStore.state;
  if (phase === 'outro') return selectWorkspaceTabOrder.select(state).includes(workspaceId);
  return findWorkspaceTabGroup(selectWorkspaceTabGroups.select(state), workspaceId) !== undefined;
}

/**
 * A plain width change that also absorbs the strip gap, so tabs slide shut
 * together and the controls after the strip follow without a jump. The tab
 * open/close motion is not used here: it moves the new-tab launcher once per
 * removed tab, which overshoots when a whole group collapses at once.
 */
function groupToggleMotion(
  node: HTMLElement,
  { duration, easing, onFrame }: LifecycleOptions,
): ImmediateMotionConfig {
  const slot = resize(node, { axis: 'x', duration, easing, fade: true, clip: true });
  if (!slot.css) return slot;
  const strip = node.parentElement;
  const gap = strip ? Number.parseFloat(getComputedStyle(strip).columnGap) || 0 : 0;
  const slotCss = slot.css;
  return {
    ...slot,
    css: (t, u) => `${slotCss(t, u)} margin-right: ${-u * gap}px;`,
    tick: () => onFrame(),
  };
}

/** Strip item motion: group expand/collapse, or the regular tab open/close. */
export function workspaceTabStripItemMotion(node: HTMLElement, options: LifecycleOptions) {
  return isGroupToggle(node, options.phase)
    ? groupToggleMotion(node, options)
    : workspaceTabLifecycleMotion(node, options);
}
