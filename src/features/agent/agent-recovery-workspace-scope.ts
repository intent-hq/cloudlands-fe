interface Authority {
  current(): boolean;
  retired: Set<string>;
}
let authority: Authority | undefined;

/** Global mirrors must still honor the workspace authority of every entry. */
export function agentRecoveryWorkspaceCurrent(workspaceId: string): boolean {
  return !authority || (authority.current() && !authority.retired.has(workspaceId));
}
export function installAgentRecoveryWorkspaceScope(current: () => boolean) {
  const owned: Authority = { current, retired: new Set() };
  authority = owned;
  return {
    retired: owned.retired,
    current: (workspaceId: string) =>
      authority === owned && current() && !owned.retired.has(workspaceId),
    dispose: () => {
      if (authority === owned) authority = undefined;
    },
  };
}
