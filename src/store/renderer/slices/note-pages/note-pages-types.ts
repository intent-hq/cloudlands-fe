import type {
  NoteStagedSaveInput,
  NoteSealedSaveIdentity,
} from '$lib/client/note-source-operation';
import type { NoteAssemblyLease } from '$features/notes/virtualized/note-assembly-reservation';
import type { NoteDocumentSession } from '$features/notes/virtualized/editing/note-document-edit-session';
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
  NoteStagedSaveOperation,
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
export interface NoteDocumentSaveCapture {
  generation: number;
  baseLength: number;
  length: number;
  cursor: number;
  throughSequence: number;
}
/** Recovery DATA only. The private runtime issuer, never this DTO, owns dispatch. */
export interface NoteLocalPointSaveRecord {
  readonly kind: 'local-point';
  readonly phase:
    'preparing' | 'sealed' | 'invoked' | 'unknown' | 'pending' | 'committed' | 'refused';
  readonly input: NoteStagedSaveInput;
  readonly sealed?: NoteSealedSaveIdentity;
  readonly group: number;
  readonly documentGeneration: number;
  readonly cursor: number;
  readonly throughSequence: number;
  readonly controlOwner: string;
  readonly controlResource: string;
  readonly receipt?: NoteCommitReceipt;
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
  /** Serializable document history; native documents and provisional plans stay outside Redux. */
  document?: NoteDocumentSession;
  history: NoteDraft[];
  receipts: NoteCommitReceipt[];
  /** Captured before IO; retained after its matching receipt, never reconstructed
   * from later drafts or the refreshed source. This alone is not a rebase proof. */
  committedDocumentSave?: {
    operation: NoteSpliceOperation | NoteStagedSaveOperation;
    document: NoteDocumentSaveCapture;
    receipt: NoteCommitReceipt;
  };
  localPointSave?: NoteLocalPointSaveRecord;
  pending: {
    document?: NoteDocumentSaveCapture;
    operation: NoteSpliceOperation | NoteStagedSaveOperation;
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
