/** Prepared note paging contract; never interchangeable with a complete Note. */
export interface NoteScope {
  backendId: string;
  workspaceId: string;
  noteId: string;
  noteInstanceId: string;
}
export interface SourceRange {
  start: number;
  end: number;
}
interface NotePageIdentity {
  scope: NoteScope;
  sourceRevision: string;
  snapshotId: string;
  expiresAt: string;
}
export interface NoteSourcePage extends NotePageIdentity {
  kind: 'noteSourcePage';
  sourceLength: number;
  range: SourceRange;
  text: string;
  nextCursor: string | null;
  previousCursor: string | null;
  contextRef: string;
  metadataRef: string;
}
interface CanonicalProfile {
  profile: 'canonicalNote';
  profileVersion: 1;
}
type CanonicalProvenance = 'explicit' | 'implicit' | 'repaired';
interface CanonicalNativeNode extends CanonicalProfile {
  kind: 'nativeNode';
  id: string;
  nodeType: string;
  nodeClass: 'container' | 'text' | 'atom';
  parentRef: string | null;
  childIndex: number;
  sourceRange: SourceRange;
  provenance: CanonicalProvenance;
  sourcePiecesRef?: string;
  attributesRef: string;
  marksRef?: string;
}
interface CanonicalSourceMap extends CanonicalProfile {
  kind: 'sourceMap';
  id: string;
  ownerRef: string;
  textNodeId: string | null;
  textNodeRef: string | null;
  sourceRange: SourceRange;
  renderedRange: SourceRange;
  mapping: 'identity' | 'entity' | 'normalized' | 'omitted' | 'projection';
  textRef: string | null;
}
interface CanonicalSourcePiece {
  kind: 'sourcePiece';
  id: string;
  nodeRef: string;
  sourceRange: SourceRange;
  role: 'opening' | 'body' | 'closing' | 'attribute' | 'omitted';
}
type NoteContextItem =
  | CanonicalNativeNode
  | CanonicalSourceMap
  | CanonicalSourcePiece
  | {
      kind: 'boundary';
      id: string;
      sourceRange: SourceRange;
      construct: string;
      profile?: 'canonicalNote';
      profileVersion?: 1;
      entryPath?: 'html';
      parentRef?: string;
      continuationBefore?: boolean;
      continuationAfter?: boolean;
      detailRef?: string;
      nativeRef?: string;
      attributesRef?: string;
      sourceMapRef?: string;
      htmlPosition?: CanonicalProfile & {
        tableRef: string;
        rowIndex?: number;
        columnIndex?: number;
        cellRole?: 'data' | 'header';
      };
      htmlSource?: {
        provenance: CanonicalProvenance;
        openingRange: SourceRange | null;
        bodyRange: SourceRange | null;
        closingRange: SourceRange | null;
        piecesRef?: string;
      };
      tablePosition?: {
        tableRef: string;
        rowIndex: number;
        columnIndex?: number;
        alignment?: 'none' | 'left' | 'center' | 'right';
      };
    }
  | {
      kind: 'span';
      id: string;
      sourceRange: SourceRange;
      role: string;
      nativeRef?: string | null;
      sourceMapRef?: string;
      codeSource?: CanonicalProfile & {
        openingRange: SourceRange;
        bodyRange: SourceRange;
        closingRange: SourceRange;
      };
      parentRef?: string;
      detailRef?: string;
    }
  | {
      kind: 'fragment';
      id: string;
      field: string;
      offset: number;
      text: string;
      nextRef: string | null;
    };
interface NoteMetadataItem {
  id: string;
  parentId: string | null;
  key?: string;
  keyRef?: string;
  index?: number;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  value?: string | number | boolean | null;
  valueRef?: string;
  childrenRef?: string;
}
interface NoteMappingItem extends SourceRange {
  insertedLength: number;
}
type NoteEffectItem =
  | { kind: 'createdTask'; taskNoteId: string }
  | {
      kind: 'warning';
      code: string;
      messagePreview: string;
      truncated: boolean;
      detailRef?: string;
    }
  | {
      kind: 'annotationInvalidation';
      sourceRevision: string;
      attributionGeneration: string;
      commentRevision: string;
    }
  | {
      kind: 'sourceEffect';
      reason: 'task-conversion' | 'anchor-repair' | 'phantom-scrub' | 'task-marker-projection';
      inputState: string;
      outputState: string;
      range: SourceRange;
      insertedLength: number;
      beforeDigest: string;
      afterDigest: string;
      detailRef: string;
    };
export type NoteReadPage =
  | NoteSourcePage
  | (NotePageIdentity & {
      kind: 'noteTaskIdsPage';
      totalItems: number;
      startIndex: number;
      items: Array<{
        index: number;
        taskNoteIdLength: number;
        sourceRange: SourceRange;
        taskNoteId?: string;
        taskNoteIdRef?: string;
      }>;
      nextCursor: string | null;
    })
  | (NotePageIdentity & {
      kind: 'noteContextPage';
      items: NoteContextItem[];
      nextCursor: string | null;
    })
  | (NotePageIdentity & {
      kind: 'noteMetadataPage';
      items: NoteMetadataItem[];
      nextCursor: string | null;
    })
  | {
      kind: 'noteMappingPage';
      scope: NoteScope;
      operationId: string;
      beforeRevision: string;
      afterRevision: string;
      items: NoteMappingItem[];
      nextCursor: string | null;
    }
  | {
      kind: 'noteEffectsPage';
      scope: NoteScope;
      operationId: string;
      beforeRevision: string;
      afterRevision: string;
      items: NoteEffectItem[];
      convertedCount: number;
      nextCursor: string | null;
    };
export type NotePageRequest = { maxWireBytes?: number; maxItems?: number } & (
  | ({ kind: 'source'; maxSourceBytes?: number } & (
      | {
          cursor: string;
          at?: never;
          direction?: never;
          sourceRevision?: never;
          noteInstanceId?: never;
          snapshotId?: never;
        }
      | {
          cursor?: never;
          at?: number;
          direction?: 'forward' | 'backward';
          sourceRevision?: string;
          noteInstanceId?: string;
          snapshotId?: string;
        }
    ))
  | {
      kind: 'taskIds';
      cursor?: string;
      sourceRevision?: string;
      noteInstanceId?: string;
      snapshotId?: string;
    }
  | { kind: 'context'; contextRef: string; cursor?: string }
  | { kind: 'metadata'; ref: string; cursor?: string }
  | { kind: 'mapping' | 'effects'; operationId: string; ref: string; cursor?: string }
);
export interface NotePageState {
  kind: 'notePageState';
  scope: NoteScope;
  stateGeneration: string;
  sourceRevision: string;
  attributionGeneration: string;
  attributionState: 'pending' | 'ready';
  commentRevision: string;
  deleted: boolean;
  invalidation: 'all';
}
export interface NoteSplice extends SourceRange {
  text: string;
}
export interface NoteSpliceOperation {
  scope: NoteScope;
  baseRevision: string;
  operationId: string;
  expiresAt: string;
  payloadDigest: string;
  splices: NoteSplice[];
}
export interface NoteCommitReceipt {
  kind: 'noteCommitReceipt';
  outcome: 'committed';
  scope: NoteScope;
  operationId: string;
  payloadDigest: string;
  beforeRevision: string;
  afterRevision: string;
  sourceLength: number;
  mappingRef: string;
  effectsRef: string;
  inverseRef: string;
  receiptExpiresAt: string;
  invalidation: 'all';
  headerDigest?: string;
  viewId?: string;
}
/** Inline saves only. Staged writes are owned by the full-document operation integration. */
export type NoteSaveOutcome =
  | NoteCommitReceipt
  | {
      kind: 'noteOperationStatus';
      scope: NoteScope;
      operationId: string;
      payloadDigest: string;
      outcome: 'pending' | 'unknown' | 'conflict' | 'rejected';
      error?: { code: string; currentRevision?: string };
    };
export interface NotePagingCapabilities {
  backendId: string;
  annotations: boolean;
}
export interface NotePagesClient {
  capabilities(): Promise<NotePagingCapabilities | null>;
  read(workspaceId: string, noteId: string, page: NotePageRequest): Promise<NoteReadPage>;
  subscribe(
    workspaceId: string,
    noteId: string,
    onState: (state: NotePageState) => void,
    onReset: (error?: string) => void,
  ): () => void;
  applySplices(operation: NoteSpliceOperation): Promise<NoteSaveOutcome>;
  operationStatus(operation: NoteSpliceOperation): Promise<NoteSaveOutcome>;
}
export function sameNoteScope(a: NoteScope, b: NoteScope): boolean {
  return (
    a.backendId === b.backendId &&
    a.workspaceId === b.workspaceId &&
    a.noteId === b.noteId &&
    a.noteInstanceId === b.noteInstanceId
  );
}
