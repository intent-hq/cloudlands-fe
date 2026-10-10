import type {
  NoteDeleteReceipt,
  NoteDeleteKey,
  NoteDeleteScheduleRequest,
  NoteDeletePending,
} from '$lib/client/note-delete';

/** UI authority is scoped to one backend selection, never just a textual note ID. */
export interface NoteDeleteView {
  backendGeneration: number;
  workspaceId: string;
  noteId: string;
  owner: string;
  noteInstanceId?: string;
  phase: 'preparing' | 'pending' | 'uncertain' | 'cancelled' | 'deleted' | 'failed';
  held: boolean;
  hidden: boolean;
  receipt?: NoteDeleteReceipt;
  pending?: NoteDeletePending;
  epoch?: string;
  sequence?: number;
  request?: NoteDeleteScheduleRequest;
  /** Caller ownership is learned separately from whether cancellation remains possible. */
  ownedOperation?: { backendGeneration: number; operationKey: NoteDeleteKey };
  canCancel: boolean;
  /** Conservative local monotonic deadline, not wall time or a commit timer. */
  deadline?: number;
  error?: string;
  failureCode?: 'unavailable' | 'replaced' | 'registration-limit';
  settledAt?: number;
  /** Targeted current absence, not merely a historical DELETED receipt. */
  terminalAbsent?: { epoch: string; sequence: number };
  waitingForSlimRevision?: number;
}
export interface NoteDeleteRecoveryDraft {
  backendGeneration: number;
  workspaceId: string;
  noteId: string;
  ownerId: string;
  content: string;
  baseContent: string;
  rev?: number;
}
export const noteDeleteKey = (generation: number, workspaceId: string, noteId: string) =>
  JSON.stringify([generation, workspaceId, noteId]);

export type NoteDeleteDraftOwner = Pick<
  NoteDeleteRecoveryDraft,
  'backendGeneration' | 'workspaceId' | 'noteId' | 'ownerId'
>;
export const noteDeleteDraftKey = (owner: NoteDeleteDraftOwner) =>
  JSON.stringify([owner.backendGeneration, owner.workspaceId, owner.noteId, owner.ownerId]);
