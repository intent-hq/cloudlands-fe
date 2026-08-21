interface WorkspaceCreatePullPolicy {
  branchBehind: number;
  isLocalRepository: boolean;
  isNewRepository: boolean;
  skipIsolation: boolean;
  pullEnabled: boolean;
}

/**
 * Pull only when workspace creation will use the selected checkout directly.
 * Isolated creation resolves its base from the remote-tracking ref and must not
 * rebase or stash the user's source checkout.
 */
export function shouldPullSourceRepositoryBeforeCreate({
  branchBehind,
  isLocalRepository,
  isNewRepository,
  skipIsolation,
  pullEnabled,
}: WorkspaceCreatePullPolicy): boolean {
  return branchBehind > 0 && isLocalRepository && !isNewRepository && skipIsolation && pullEnabled;
}
