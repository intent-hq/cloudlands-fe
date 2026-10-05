import type { NoteAssemblyLease } from '$features/notes/virtualized/note-assembly-reservation';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { NoteWindow } from '$features/notes/virtualized/note-window-reader';
import type { NoteResourceLedger } from '$features/notes/virtualized/note-resource-ledger';
import type {
  NoteCommitReceipt,
  NoteScope,
  NotePageState,
  NotePageRequest,
  NoteReadPage,
  NoteSplice,
  NoteSpliceOperation,
  SourceRange,
} from '$lib/client/note-pages';
export interface NoteDraft {
  scope: NoteScope;
  sequence: number;
  baseRevision: string;
  /** One native transaction's coordinates after all earlier dirty drafts.
   * The save planner composes these into the wire's single-base batch. */
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
  windows: Record<
    string,
    {
      at: number;
      request: number;
      value: NoteWindow | null;
      error: string | null;
      loading: boolean;
      resourceOwner?: string;
    }
  >;
  generation: number;
  state: NotePageState | null;
  status: 'connecting' | 'ready' | 'legacy' | 'error' | 'deleted';
  error: string | null;
  pages: Record<string, NoteReadPage>;
  pageAllocations: Record<string, { owner: string; resource: string }>;
  pageOrder: string[];
  requests: Record<string, boolean>;
  deferredRead: NotePageRequest | null;
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
interface CleanNotePage {
  workspaceId: string;
  noteId: string;
  key: string;
  owner: string;
}
export interface NotePagesState {
  /** Shared across workspaces; runtime leases outlive session invalidation. */
  resourceLedger: NoteResourceLedger;
  /** Only admitted clean allocations; bounded by ledger owner metadata capacity. */
  cleanPages: Collection<CleanNotePage, 'owner'>;
  nextGeneration: number;
  physicalReads: Record<
    string,
    {
      workspaceId: string;
      noteId: string;
      ticket?: string;
      /** Includes queued admission; only ledger physicalReads counts active IO. */
      resourceOwner?: string;
      assembly?: NoteAssemblyLease;
      wireBytes?: number;
    }
  >;
  byWorkspaceId: Record<string, NotePagesWorkspaceState>;
}
