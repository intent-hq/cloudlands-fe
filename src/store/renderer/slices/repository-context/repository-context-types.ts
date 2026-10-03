import type {
  NativeReviewOwner,
  NativeReviewPreparedView,
  NativeReviewObservation,
} from '$shared/types/native-review-operation';
import type {
  RepositorySelectionEdit,
  SelectionPreview,
  SelectionObservation,
} from '$shared/types/repository-selection';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  ExecutionScope,
  RepositoryContextRevision,
  RepositoryRootContext,
  RepositoryContextRequest,
} from '$shared/types/repository-context';

interface RepositoryContextRootEntry {
  id: string;
  context: RepositoryRootContext;
}

/** Capture once for a fresh explicit demand; admission is renderer correlation, not authority. */
export interface RepositoryContextDemand {
  readonly workspaceId: string;
  /** Unique to this demand lifetime, including a new explicit read after retirement. */
  readonly demandId: string;
  readonly admission: string | null;
}

/** Only the root observation owner associates a demand with its original private request. */
export interface RepositoryContextDemandOwnership {
  demandId: string;
  admission: string;
  request: RepositoryContextRequest;
}

/** Binding-free presentation for the original demand owner. Null selection means inactive. */
export interface RepositoryContextDemandView {
  status: RepositoryContextWorkspaceState['status'];
  scope: ExecutionScope | null;
  revision: RepositoryContextRevision | null;
  roots: readonly RepositoryRootContext[];
  unavailableReason: RepositoryContextWorkspaceState['unavailableReason'];
}

export interface RepositoryContextWorkspaceState {
  /** Existing connection/admission context, supplied by its owner at integration. */
  binding: string | null;
  ownership: RepositoryContextDemandOwnership | null;
  status: 'inactive' | 'loading' | 'ready' | 'unavailable';
  scope: ExecutionScope | null;
  revision: RepositoryContextRevision | null;
  roots: Collection<RepositoryContextRootEntry, 'id'>;
  pending: RepositoryContextRequest | null;
  unavailableReason: 'read-failed' | 'context-changed' | 'invalid-response' | null;
}

export interface RepositorySelectionEditState {
  editId: string;
  owner: RepositorySelectionEdit;
  status: 'capturing' | 'ready' | 'pending' | 'retired' | 'closed' | 'unavailable';
  preview: SelectionPreview | null;
  observation: SelectionObservation | null;
}

export interface NativeReviewAttemptState {
  attemptId: string;
  /** Closing presentation does not settle the original worker or its issued results. */
  workerEnded: boolean;
  pendingResults: number;
  owner: NativeReviewOwner;
  status: 'capturing' | 'ready' | 'pending' | 'retired' | 'closed' | 'unavailable';
  preview: NativeReviewPreparedView | null;
  observation: NativeReviewObservation | null;
}
export interface RepositoryContextState {
  nativeReviewAttempts?: Collection<NativeReviewAttemptState, 'attemptId'>;
  selectionEdits?: Collection<RepositorySelectionEditState, 'editId'>;
  byWorkspaceId: Record<string, RepositoryContextWorkspaceState>;
}
