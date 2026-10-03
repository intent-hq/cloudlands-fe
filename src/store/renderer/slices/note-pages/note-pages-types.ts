import type {
  NoteCommitReceipt,
  NoteScope,
  NotePageState,
  NoteReadPage,
  NoteSplice,
  NoteSpliceOperation,
  SourceRange,
} from '$lib/client/note-pages';
export interface NoteDraft {
  scope: NoteScope;
  sequence: number;
  baseRevision: string;
  splices: NoteSplice[];
  selection: {
    anchor: number;
    head: number;
    anchorAffinity: 'before' | 'after';
    headAffinity: 'before' | 'after';
  };
}
export interface NotePageSession {
  panels: Record<string, SourceRange[]>;
  generation: number;
  state: NotePageState | null;
  status: 'connecting' | 'ready' | 'legacy' | 'error' | 'deleted';
  error: string | null;
  pages: Record<string, NoteReadPage>;
  pageOrder: string[];
  requests: Record<string, boolean>;
  /** Session-owned, never evicted with clean pages. Preserved until explicit discard. */
  drafts: NoteDraft[];
  history: NoteDraft[];
  receipts: NoteCommitReceipt[];
  pending: {
    operation: NoteSpliceOperation;
    throughSequence: number;
    status: 'saving' | 'unknown' | 'pending' | 'conflict' | 'rejected';
  } | null;
  needsReconcile: boolean;
  readRecoveryAttempted: boolean;
}
export interface NotePagesWorkspaceState {
  notes: Record<string, NotePageSession>;
}
export interface NotePagesState {
  nextGeneration: number;
  byWorkspaceId: Record<string, NotePagesWorkspaceState>;
}
