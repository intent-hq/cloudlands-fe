import type { SagaGenerator } from 'typed-redux-saga';
import type { MutationResult } from '$lib/client/client-types';
import type { GitStatus } from '$shared/types';
import type { GitMutationLease } from '../../../utils/worktree-mutation-queue';
import type { GitWriteEntry, GitWriteOperation } from '../git-write-types';

/** Captured before queueing; dispatch epochs and publication authority have different lifetimes. */
export interface GitWriteAuthority {
  canDispatch(): boolean;
  canPublish(): boolean;
}

export interface GitWriteSagaDependencies {
  /** Source defaults to optimistic snapshots; hosts may wait for authoritative refresh instead. */
  optimisticStatus?: boolean;
  selectOperation(workspaceId: string, requestId: string): SagaGenerator<GitWriteEntry | undefined>;
  selectStatus(workspaceId: string): SagaGenerator<GitStatus | null | undefined>;
  /** Return one transport-lifetime transaction; undefined declines a no-longer-valid source. */
  prepare(
    workspaceId: string,
    operation: GitWriteOperation,
    canExecute: () => boolean,
  ): SagaGenerator<(() => Promise<MutationResult>) | undefined>;
  reconcile(
    workspaceId: string,
    requestId: string,
    lease: GitMutationLease,
    canPublish: () => boolean,
  ): SagaGenerator<void>;
  invalidate(workspaceId: string): void;
  publish(
    workspaceId: string,
    operation: GitWriteOperation,
    result: MutationResult,
    canPublish: () => boolean,
  ): SagaGenerator<void>;
  captureAuthority?(workspaceId: string, operation: GitWriteOperation): GitWriteAuthority;
  unknownError(): string;
  logError(message: string, error: unknown): void;
}
