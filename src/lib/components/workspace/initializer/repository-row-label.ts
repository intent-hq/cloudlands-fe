/**
 * Label of the New Workspace form picker row ("Codebase"), which follows the
 * selection once plain folders (Labs) are offered: a selected plain folder →
 * "Folder", a selected git repository → "Codebase". With nothing selected it
 * follows what the list can hold:
 * - a git repository (forge or local) is listed → "Codebase";
 * - otherwise no forge connected, or a plain-folder entry listed → "Folder";
 * - otherwise (forge connected, empty list) → "Codebase".
 * Plain folders not offered keep "Codebase". Unknown forge status (pending or
 * failed read) never counts as "no forge".
 */
export type ForgeConnectionState = 'connected' | 'none' | 'unknown';

export type RepositoryRowLabelKind = 'codebase' | 'folder';

export interface RepositoryRowLabelInput {
  plainFoldersOffered: boolean;
  forgeState: ForgeConnectionState;
  hasGitRepositoryEntry: boolean;
  hasPlainFolderEntry: boolean;
  /** Kind of the selected entry; absent or null with nothing selected. */
  selected?: RepositoryRowLabelKind | null;
}

export function resolveRepositoryRowLabelKind(
  input: RepositoryRowLabelInput,
): RepositoryRowLabelKind {
  if (!input.plainFoldersOffered) return 'codebase';
  if (input.selected) return input.selected;
  if (input.hasGitRepositoryEntry) return 'codebase';
  if (input.forgeState === 'none' || input.hasPlainFolderEntry) return 'folder';
  return 'codebase';
}

export interface ForgeConnectionInput {
  githubConnected: boolean;
  githubSettled: boolean;
  githubFailed: boolean;
  gitlabConnected: boolean;
  gitlabSettled: boolean;
  gitlabFailed: boolean;
}

export function resolveForgeConnectionState(input: ForgeConnectionInput): ForgeConnectionState {
  if (input.githubConnected || input.gitlabConnected) return 'connected';
  if (input.githubFailed || !input.githubSettled) return 'unknown';
  if (input.gitlabFailed || !input.gitlabSettled) return 'unknown';
  return 'none';
}
