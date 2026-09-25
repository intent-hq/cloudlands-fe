import type { ActionDefinition, ActionSplit, ResolvedAction } from './types';

export function defineActions<const T extends readonly ActionDefinition[]>(actions: T): T {
  return actions;
}

export function resolveActions<T extends ResolvedAction>(actions: readonly T[]): T[] {
  const ids = new Set<string>();
  const commands = new Set<string>();
  return actions.flatMap((action): T[] => {
    if (action.when === false) return [];
    if (ids.has(action.id)) throw new Error(`Duplicate menu action id: ${action.id}`);
    ids.add(action.id);
    if (action.commandId) {
      if (commands.has(action.commandId)) {
        throw new Error(`Duplicate menu command target: ${action.commandId}`);
      }
      commands.add(action.commandId);
    }
    if (!action.children) return [{ ...action }];
    const children = resolveActions<ResolvedAction>(action.children);
    return children.length > 0 ? [{ ...action, children } as T] : [];
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
