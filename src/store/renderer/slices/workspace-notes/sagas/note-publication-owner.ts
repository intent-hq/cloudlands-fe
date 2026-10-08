import { put, select } from 'typed-redux-saga';
import { ensureNotePublicationLifetime } from '../workspace-notes-slice';
import type { WorkspaceNotesState } from '../workspace-notes-types';

type PublicationState = {
  workspaceNotes: WorkspaceNotesState;
  daemonHealth?: { connectionGeneration: number };
};

export type NotePublicationOwner = {
  workspaceId: string;
  exhausted: boolean;
  backendGeneration: number | undefined;
  workspaceLifetime: number | undefined;
  readAuthority: string | undefined;
};

function readOwner(state: PublicationState, workspaceId: string): NotePublicationOwner {
  const workspace = state.workspaceNotes.byWorkspaceId[workspaceId];
  return {
    workspaceId,
    exhausted: state.workspaceNotes.publicationAuthorityExhausted === true,
    backendGeneration: state.daemonHealth?.connectionGeneration,
    workspaceLifetime: workspace?.publicationLifetime,
    readAuthority: workspace?.deleteReadAuthority,
  };
}

/** Capture before IO, never reconstruct a response's owner from the completion state. */
export function* captureNotePublicationOwner(workspaceId: string) {
  const owner = yield* select(readOwner, workspaceId);
  if (owner.exhausted || owner.workspaceLifetime !== undefined) return owner;
  // Allocate this workspace before IO. Other workspaces must not invalidate its capture.
  yield* put(ensureNotePublicationLifetime(workspaceId));
  return yield* select(readOwner, workspaceId);
}

function sameLifetime(current: NotePublicationOwner, owner: NotePublicationOwner): boolean {
  return (
    !owner.exhausted &&
    !current.exhausted &&
    current.backendGeneration === owner.backendGeneration &&
    owner.workspaceLifetime !== undefined &&
    current.workspaceLifetime === owner.workspaceLifetime
  );
}

export function* isNotePublicationLifetimeCurrent(owner: NotePublicationOwner) {
  return sameLifetime(yield* select(readOwner, owner.workspaceId), owner);
}

export function* isNotePublicationOwnerCurrent(owner: NotePublicationOwner) {
  const current = yield* select(readOwner, owner.workspaceId);
  return sameLifetime(current, owner) && current.readAuthority === owner.readAuthority;
}
