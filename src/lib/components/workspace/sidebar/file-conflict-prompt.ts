/**
 * Capability-gated drop-conflict prompt seam for FilesPanel.
 *
 * On the electron platform the prompt is the native OS message box via the
 * `dialog.message` bridge (`dialog:message` IPC). On web there is no native
 * dialog — `dialog:message` used to be an UNBRIDGED_INVOKE_ALLOWLIST fold to
 * button index 0, silently resolving every conflict to 'skip' — so the caller
 * must present the in-app MessageDialog instead and wait for a real choice.
 */
import { dialog } from '$lib/electron-bridge';
import { getPlatform } from '$lib/utils/platform-capabilities';
import { m } from '$shared/paraglide/messages.js';

/** How a drop conflict is resolved; order matches FILE_CONFLICT_BUTTONS. */
export type ConflictResolution = 'skip' | 'rename' | 'overwrite';

export const FILE_CONFLICT_TITLE: string = m.workspace_fileConflict_title();

/** Button labels; the index doubles as the wire-level button index. */
export const FILE_CONFLICT_BUTTONS: readonly [string, string, string] = [
  m.workspace_fileConflict_skip_label(),
  m.workspace_fileConflict_rename_label(),
  m.workspace_fileConflict_overwrite_label(),
] as const;

/** Body text shown for a conflicting drop of `fileName`. */
export function fileConflictMessage(fileName: string): string {
  return m.workspace_fileConflict_message({ fileName });
}

/** Map a button index to its resolution (0=skip, 1=rename, 2=overwrite; unknown=skip). */
export function conflictResolutionFromIndex(index: number): ConflictResolution {
  switch (index) {
    case 2:
      return 'overwrite';
    case 1:
      return 'rename';
    default:
      return 'skip';
  }
}

/** Handed to the web dialog opener; `resolve` reports the chosen button index. */
export interface WebConflictPromptRequest {
  fileName: string;
  resolve: (buttonIndex: number) => void;
}

/**
 * Prompt the user to resolve a drop conflict for `fileName`.
 *
 * Electron: native `dialog.message` (via the bridge seeder). Web: invokes
 * `openWebDialog` with a request whose `resolve(buttonIndex)` settles the
 * returned promise — it stays pending until the user actually chooses.
 */
export async function promptFileConflict(
  fileName: string,
  openWebDialog: (request: WebConflictPromptRequest) => void,
): Promise<ConflictResolution> {
  if (getPlatform() === 'electron') {
    // Still routes through the mock router: this only works because
    // native-dialog-bridge-seeder registers the `dialog:message` forwarder at
    // startup (seeders/index.ts); without it this invoke rejects at runtime.
    const index = await dialog.message(fileConflictMessage(fileName), {
      title: FILE_CONFLICT_TITLE,
      type: 'warning',
      buttons: [...FILE_CONFLICT_BUTTONS],
    });
    return conflictResolutionFromIndex(index);
  }
  return new Promise<ConflictResolution>((resolve) => {
    openWebDialog({
      fileName,
      resolve: (buttonIndex) => resolve(conflictResolutionFromIndex(buttonIndex)),
    });
  });
}
