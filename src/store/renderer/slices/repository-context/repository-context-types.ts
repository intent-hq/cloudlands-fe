import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
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

export interface RepositoryContextWorkspaceState {
  /** Existing connection/admission context, supplied by its owner at integration. */
  binding: string | null;
  status: 'inactive' | 'loading' | 'ready' | 'unavailable';
  scope: ExecutionScope | null;
  revision: RepositoryContextRevision | null;
  roots: Collection<RepositoryContextRootEntry, 'id'>;
  pending: RepositoryContextRequest | null;
  unavailableReason: 'read-failed' | 'context-changed' | 'invalid-response' | null;
}

export interface RepositoryContextState {
  byWorkspaceId: Record<string, RepositoryContextWorkspaceState>;
}
