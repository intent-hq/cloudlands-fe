import type { ActionDefinition, ActionSplit } from './types';

export function defineActions<const T extends readonly ActionDefinition[]>(actions: T): T {
  return actions;
}

export function resolveActions(actions: readonly ActionDefinition[]): ActionDefinition[] {
  return actions.flatMap((action) => {
    if (action.when === false) return [];
    if (!action.children) return [{ ...action }];
    const children = resolveActions(action.children);
    return children.length > 0 ? [{ ...action, children }] : [];
  });
}

export function splitActions(
  actions: readonly ActionDefinition[],
  visibleCount: number,
): ActionSplit {
  const resolved = resolveActions(actions);
  const splitIndex = Math.max(0, Math.min(resolved.length, Math.floor(visibleCount)));
  return {
    visible: resolved.slice(0, splitIndex),
    overflow: resolved.slice(splitIndex),
  };
}
