import type { GuestsWarning, LocalChangesWarning } from './workspace-operations-types';

export type WorkspaceRemovalKind = 'archive' | 'delete';

export interface OutstandingWorkInput {
  agentCount: number;
  hookCount: number;
  openPrCount: number;
  localChanges: LocalChangesWarning | null | undefined;
  guests: GuestsWarning | null | undefined;
}

export interface OutstandingWork {
  /** Agents or hooks the operation stops. */
  running: boolean;
  /** Unpushed or uncommitted changes the operation loses (delete only). */
  localChanges: boolean;
  /** Running work, open PRs, or lost local changes. */
  work: boolean;
  /** Collaborators or open invites the operation removes. */
  guests: boolean;
  guestsOnly: boolean;
  needsConfirmation: boolean;
}

/**
 * The one rule for what an archive/delete must confirm. The saga gates on
 * `needsConfirmation` and the warning dialog renders a section for each flag,
 * so the dialog never opens without something to show. Archive keeps local
 * changes on disk, so they never count for it.
 */
export function outstandingWork(
  kind: WorkspaceRemovalKind,
  { agentCount, hookCount, openPrCount, localChanges, guests }: OutstandingWorkInput,
): OutstandingWork {
  const running = agentCount > 0 || hookCount > 0;
  const hasLocalChanges =
    kind === 'delete' &&
    Boolean(localChanges?.hasUnpushedCommits || localChanges?.hasUncommittedChanges);
  const work = running || openPrCount > 0 || hasLocalChanges;
  const hasGuests = (guests?.collaboratorCount ?? 0) + (guests?.openInviteCount ?? 0) > 0;
  return {
    running,
    localChanges: hasLocalChanges,
    work,
    guests: hasGuests,
    guestsOnly: hasGuests && !work,
    needsConfirmation: work || hasGuests,
  };
}
