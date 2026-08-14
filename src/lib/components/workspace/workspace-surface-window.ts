export const WORKSPACE_SURFACE_OVERSCAN_STACKS = 1;

export function resolveLiveWorkspaceIds(
  stacks: string[][],
  activeWorkspaceId: string | null,
  visibleStackKeys: readonly string[],
  materializingWorkspaceId: string | null = null,
  overscan = WORKSPACE_SURFACE_OVERSCAN_STACKS,
): string[] {
  const seedIndexes = new Set<number>();
  const visibleKeys = new Set(visibleStackKeys);

  stacks.forEach((stack, index) => {
    if (
      visibleKeys.has(stack[0]) ||
      (activeWorkspaceId !== null && stack.includes(activeWorkspaceId)) ||
      (materializingWorkspaceId !== null && stack.includes(materializingWorkspaceId))
    ) {
      seedIndexes.add(index);
    }
  });

  const liveIndexes = new Set<number>();
  for (const index of seedIndexes) {
    for (let offset = -overscan; offset <= overscan; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < stacks.length) liveIndexes.add(candidate);
    }
  }

  return stacks.flatMap((stack, index) => (liveIndexes.has(index) ? stack : []));
}
