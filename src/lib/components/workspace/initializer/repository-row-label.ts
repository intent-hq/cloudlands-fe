/**
 * Label of the New Workspace form picker row ("Codebase"), which follows what
 * the list can hold once plain folders (Labs) are offered:
 * - a git repository (forge or local) is listed → "Codebase";
 * - otherwise no forge connected, or a plain-folder entry listed → "Project";
 * - otherwise (forge connected, empty list) → "Codebase".
 * Plain folders not offered keep "Codebase". Unknown forge status (pending or
 * failed read) never counts as "no forge".
 */
export type ForgeConnectionState = 'connected' | 'none' | 'unknown';

export type RepositoryRowLabelKind = 'codebase' | 'project';

export interface RepositoryRowLabelInput {
  plainFoldersOffered: boolean;
  forgeState: ForgeConnectionState;
  hasGitRepositoryEntry: boolean;
  hasPlainFolderEntry: boolean;
}

export function resolveRepositoryRowLabelKind(
  input: RepositoryRowLabelInput,
): RepositoryRowLabelKind {
  if (!input.plainFoldersOffered) return 'codebase';
  if (input.hasGitRepositoryEntry) return 'codebase';
  if (input.forgeState === 'none' || input.hasPlainFolderEntry) return 'project';
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
