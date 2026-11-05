import type { ImmediateMotionConfig } from '$lib/motion';
import { store as appStore } from '$store/renderer/store';
import { findWorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
import {
  selectWorkspaceTabGroups,
  selectWorkspaceTabOrder,
} from '$store/renderer/slices/tab-state/tab-state-selectors';
import { workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';

export { prepareTabOutros } from './workspace-tab-lifecycle-motion';

type LifecycleOptions = Parameters<typeof workspaceTabLifecycleMotion>[1];

const LAUNCHER_OFFSET_PROPERTY = '--workspace-tab-launcher-offset';

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

interface LauncherGlide {
  controls: HTMLElement;
  delta: number;
  duration: number;
  easing: (t: number) => number;
}

let pendingGlide: LauncherGlide | null = null;
let launcherOffset = 0;
let launcherFrame: number | null = null;

/**
 * The strip resizes in one step when a group toggles, so the new-tab launcher
 * after it would jump. All items that toggle in one update add their width
 * here, and the launcher then glides from its old place to its new one.
 */
function glideLauncher(glide: LauncherGlide) {
  if (pendingGlide) {
    pendingGlide.delta += glide.delta;
    return;
  }
  pendingGlide = glide;
  queueMicrotask(() => {
    const { controls, delta, duration, easing } = pendingGlide ?? glide;
    pendingGlide = null;
    if (launcherFrame !== null) cancelAnimationFrame(launcherFrame);
    const from = launcherOffset + delta;
    let startedAt: number | null = null;
    const step = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      launcherOffset = from * (1 - easing(progress));
      controls.style.setProperty(LAUNCHER_OFFSET_PROPERTY, `${launcherOffset}px`);
      launcherFrame = progress < 1 ? requestAnimationFrame(step) : null;
    };
    controls.style.setProperty(LAUNCHER_OFFSET_PROPERTY, `${from}px`);
    launcherFrame = requestAnimationFrame(step);
  });
}

/**
 * Group tabs fade in place. Leaving items are taken out of the flow by the
 * strip's flip animation, so their neighbours slide over them; a width
 * animation here would fight that slide.
 */
function groupToggleMotion(
  node: HTMLElement,
  { duration, easing, phase, onFrame }: LifecycleOptions,
): ImmediateMotionConfig {
  if (duration === 0) return { duration: 0 };
  const strip = node.parentElement;
  const controls = strip?.parentElement;
  if (strip && controls) {
    const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
    const width = node.getBoundingClientRect().width + gap;
    glideLauncher({ controls, delta: phase === 'outro' ? width : -width, duration, easing });
  }
  return {
    duration: phase === 'outro' ? duration / 2 : duration,
    easing,
    css: (t) => `opacity: ${t};`,
    tick: () => onFrame(),
  };
}

/** Strip item motion: group expand/collapse, or the regular tab open/close. */
export function workspaceTabStripItemMotion(node: HTMLElement, options: LifecycleOptions) {
  return isGroupToggle(node, options.phase)
    ? groupToggleMotion(node, options)
    : workspaceTabLifecycleMotion(node, options);
}
