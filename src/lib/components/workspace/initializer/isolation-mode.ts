/**
 * Effective isolated-checkout mode for new local workspaces.
 *
 * The daemon provisions either a linked git worktree or a standalone CoW
 * (copy-on-write) clone (PROTOCOL §5.1 `Workspace.checkoutMode`), gated by the
 * BE-owned `workspace.cowIsolation` setting (§5.12) and the machine's CoW
 * capability (`Workspace.cowSupported`, a workspaces-root filesystem
 * capability independent of any one workspace). Creation-flow copy uses this
 * to say "CoW checkout" vs "worktree".
 */
import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
import { m } from '$shared/paraglide/messages.js';

export type IsolationMode = 'worktree' | 'cow';

/** Human noun for the isolated checkout the daemon would provision. */
export function isolationNoun(mode: IsolationMode): string {
  return mode === 'cow'
    ? m.workspace_isolationMode_cowCheckout_label()
    : m.workspace_isolationMode_worktree_label();
}

/**
 * Resolve the effective mode: `cow` only when the global
 * `workspace.cowIsolation` setting is on AND the machine supports CoW
 * (read off any loaded workspace's `cowSupported` aggregate — a machine
 * capability, so any workspace carrying it is authoritative). Defaults to
 * `worktree` when the setting is off, capability is unknown, or the read fails.
 *
 * Pass `workspaces` (e.g. a selector readable's current value) so callers can
 * re-resolve when workspace items hydrate after mount; when omitted, falls
 * back to a one-time snapshot of the store.
 */
export async function resolveEffectiveIsolationMode(
  workspaces?: ReadonlyArray<{ cowSupported?: boolean }>,
): Promise<IsolationMode> {
  try {
    const setting = await appClient.settings.get('workspace.cowIsolation');
    if (setting?.value !== true) return 'worktree';
    const items = workspaces ?? selectWorkspaceItems.select(appStore.state);
    const cowSupported = items.some((workspace) => workspace.cowSupported === true);
    return cowSupported ? 'cow' : 'worktree';
  } catch {
    return 'worktree';
  }
}
