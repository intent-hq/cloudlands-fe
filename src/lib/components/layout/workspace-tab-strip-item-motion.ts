import type { ImmediateMotionConfig } from '$lib/motion';
import { workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';

export { prepareTabOutros } from './workspace-tab-lifecycle-motion';

type LifecycleOptions = Parameters<typeof workspaceTabLifecycleMotion>[1];

/**
 * Strip item motion. Tabs use the regular open/close motion. Group chips,
 * which come and go when a group is made or ungrouped, simply fade; group
 * expand/collapse never adds or removes items, it is a CSS width change.
 */
export function workspaceTabStripItemMotion(
  node: HTMLElement,
  options: LifecycleOptions,
): ImmediateMotionConfig | ReturnType<typeof workspaceTabLifecycleMotion> {
  if (node.dataset.workspaceTabMotion) return workspaceTabLifecycleMotion(node, options);
  const { duration, easing, onFrame } = options;
  if (duration === 0) return { duration: 0 };
  return { duration, easing, css: (t: number) => `opacity: ${t};`, tick: () => onFrame() };
}
