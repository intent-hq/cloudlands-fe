import { confirm } from '$lib/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import { workspacesUsingFolder } from './plain-folder-create';

/**
 * Warns before a plain-folder workspace is created on an existing folder:
 * agents edit its files in place with no version control or undo, and it
 * may already be used by another workspace. Resolves `false` on cancel, in
 * which case nothing is created.
 */
export function confirmPlainFolderInPlace(
  folder: string,
  workspaces: readonly Workspace[],
): Promise<boolean> {
  const others = workspacesUsingFolder(workspaces, folder);
  const names = others.map((workspace) => workspace.title || workspace.id).join(', ');
  const description = [
    m.workspace_plainFolder_confirm_description({ folder }),
    ...(others.length > 0
      ? [m.workspace_plainFolder_confirm_sharedFolder_description({ workspaces: names })]
      : []),
  ].join('\n\n');
  return confirm({
    title: m.workspace_plainFolder_confirm_title(),
    description,
    confirmLabel: m.workspace_plainFolder_confirm_action(),
    cancelLabel: m.modals_bulkActionConfirm_cancel_label(),
  });
}
