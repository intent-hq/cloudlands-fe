/**
 * Label of the New Workspace form picker row ("Codebase"), which follows what
 * the list can hold once plain folders (Labs) are offered:
 * - no forge connected → "Project";
 * - otherwise a plain-folder entry is listed → "Codebase/Project";
 * - otherwise → "Codebase".
 * Plain folders not offered keep "Codebase". Unknown forge status (pending or
 * failed read) never counts as "no forge".
 */
export type ForgeConnectionState = 'connected' | 'none' | 'unknown';

export type RepositoryRowLabelKind = 'codebase' | 'codebaseOrProject' | 'project';

export interface RepositoryRowLabelInput {
  plainFoldersOffered: boolean;
  forgeState: ForgeConnectionState;
  hasPlainFolderEntry: boolean;
}

export function resolveRepositoryRowLabelKind(
  input: RepositoryRowLabelInput,
): RepositoryRowLabelKind {
  if (!input.plainFoldersOffered) return 'codebase';
  if (input.forgeState === 'none') return 'project';
  return input.hasPlainFolderEntry ? 'codebaseOrProject' : 'codebase';
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
