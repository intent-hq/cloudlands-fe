import type { MutationResult } from '$lib/client';

export type NoteRevisionMutationRequest = {
  workspaceId: string;
  noteId: string;
  run: () => Promise<MutationResult>;
};

type Completion = {
  resolve: (result: MutationResult) => void;
  reject: (error: Error) => void;
};

type Enqueue = (request: NoteRevisionMutationRequest, completion: Completion) => void;

let enqueueRevisionMutation: Enqueue | undefined;

export function registerNoteRevisionMutationQueue(enqueue: Enqueue): () => void {
  enqueueRevisionMutation = enqueue;
  return () => {
    if (enqueueRevisionMutation === enqueue) enqueueRevisionMutation = undefined;
  };
}

export function enqueueRevBumpingNoteMutation(
  workspaceId: string,
  noteId: string,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  const enqueue = enqueueRevisionMutation;
  if (!enqueue) return Promise.reject(new Error('Notes write saga is not running'));
  return new Promise((resolve, reject) => {
    enqueue({ workspaceId, noteId, run }, { resolve, reject });
  });
}
