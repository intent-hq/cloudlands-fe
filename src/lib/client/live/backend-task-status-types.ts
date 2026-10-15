import type { TaskStatus } from '../../../shared/types';
import type { MutationResult } from '../client-types';
import type { BackendRequestOptions } from './backend-transport-types';

export type TaskStatusReceipt = { status: TaskStatus; rev: number };
export type TaskStatusOutcome = {
  outcome: 'confirmed' | 'failed' | 'conflict' | 'unknown';
  receipt?: TaskStatusReceipt;
  error?: string;
};
export type TaskStatusTransport = <T = unknown>(
  method: string,
  params?: unknown,
  options?: BackendRequestOptions & { onDispatch?: () => void },
) => Promise<T>;
export type TaskStatusClient = {
  update(
    workspaceId: string,
    noteId: string,
    status: TaskStatus,
    expectedVersion: number,
    options: { onDispatch(): void },
  ): Promise<TaskStatusOutcome>;
  updateLegacy(
    workspaceId: string,
    noteId: string,
    status: TaskStatus,
    expectedVersion?: number,
  ): Promise<MutationResult>;
};
