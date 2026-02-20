/**
 * Background Git Operations Service
 *
 * Tracks in-flight git operations (commit, push, PR creation, auto-commit) per workspace.
 * Operations survive workspace navigation by living in the main process.
 * Emits domain events on state changes so renderers can subscribe.
 *
 * Auto-expires completed operations after a TTL to prevent memory leaks.
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import { unifiedEventBus } from '../../events/main/unified-event-bus';

const logger = new Logger('BackgroundGitOpsService');

/** Types of git operations we track */
export type GitOperationType = 'commit' | 'push' | 'create-pr' | 'auto-commit';

/** Status of a tracked operation */
export type GitOperationStatus = 'started' | 'in-progress' | 'completed' | 'failed';

/** Metadata for an operation */
export interface GitOperationMetadata {
  message?: string;
  prTitle?: string;
  agentId?: string;
  agentName?: string;
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  error?: string;
  step?: string;
  fileCount?: number;
  noChanges?: boolean;
  reason?: string;
}

/** A tracked git operation */
export interface TrackedGitOperation {
  id: string;
  workspaceId: WorkspaceId;
  type: GitOperationType;
  status: GitOperationStatus;
  metadata: GitOperationMetadata;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** TTL for completed operations before auto-cleanup (5 minutes) */
const COMPLETED_OP_TTL_MS = 5 * 60 * 1000;

/** Cleanup interval (1 minute) */
const CLEANUP_INTERVAL_MS = 60 * 1000;

export class BackgroundGitOpsService {
  private static instance: BackgroundGitOpsService;

  /** Map of operationId -> TrackedGitOperation */
  private operations: Map<string, TrackedGitOperation> = new Map();

  /** Cleanup timer */
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupTimer();
    logger.info('BackgroundGitOpsService initialized');
  }

  static getInstance(): BackgroundGitOpsService {
    if (!BackgroundGitOpsService.instance) {
      BackgroundGitOpsService.instance = new BackgroundGitOpsService();
    }
    return BackgroundGitOpsService.instance;
  }

  /**
   * Register a new operation. Emits git:op-started domain event.
   */
  registerOperation(
    workspaceId: WorkspaceId,
    type: GitOperationType,
    metadata: GitOperationMetadata = {},
  ): string {
    const id = uuidv4();
    const now = Date.now();

    const operation: TrackedGitOperation = {
      id,
      workspaceId,
      type,
      status: 'started',
      metadata,
      startedAt: now,
      updatedAt: now,
    };

    this.operations.set(id, operation);

    logger.info('Registered git operation', { operationId: id, workspaceId, type });

    unifiedEventBus.emitDomainEvent('git:op-started', {
      operationId: id,
      workspaceId,
      operationType: type,
      metadata: {
        message: metadata.message,
        prTitle: metadata.prTitle,
        agentId: metadata.agentId,
        agentName: metadata.agentName,
      },
    });

    return id;
  }

  /**
   * Update an operation's status and/or step. Emits git:op-progress event.
   */
  updateProgress(operationId: string, step: string, metadata?: Partial<GitOperationMetadata>): void {
    const op = this.operations.get(operationId);
    if (!op) {
      logger.warn('Cannot update progress: operation not found', { operationId });
      return;
    }

    // Terminal-state guard: skip if already completed or failed
    if (op.status === 'completed' || op.status === 'failed') {
      logger.debug('Skipping updateProgress: operation already in terminal state', {
        operationId,
        status: op.status,
      });
      return;
    }

    op.status = 'in-progress';
    op.metadata.step = step;
    if (metadata) {
      Object.assign(op.metadata, metadata);
    }
    op.updatedAt = Date.now();

    logger.debug('Operation progress', { operationId, step });

    unifiedEventBus.emitDomainEvent('git:op-progress', {
      operationId,
      workspaceId: op.workspaceId,
      operationType: op.type,
      step,
      metadata: {
        message: op.metadata.message,
        prTitle: op.metadata.prTitle,
      },
    });
  }

  /**
   * Mark operation as completed. Emits git:op-completed event.
   */
  completeOperation(
    operationId: string,
    result?: {
      commitHash?: string;
      prNumber?: number;
      prUrl?: string;
      fileCount?: number;
      noChanges?: boolean;
      reason?: string;
    },
  ): void {
    const op = this.operations.get(operationId);
    if (!op) {
      logger.warn('Cannot complete: operation not found', { operationId });
      return;
    }

    // Idempotency guard: skip if already in terminal state
    if (op.status === 'completed' || op.status === 'failed') {
      logger.debug('Skipping completeOperation: operation already in terminal state', {
        operationId,
        status: op.status,
      });
      return;
    }

    const now = Date.now();
    op.status = 'completed';
    op.completedAt = now;
    op.updatedAt = now;
    if (result) {
      Object.assign(op.metadata, result);
    }

    logger.info('Operation completed', { operationId, type: op.type });

    unifiedEventBus.emitDomainEvent('git:op-completed', {
      operationId,
      workspaceId: op.workspaceId,
      operationType: op.type,
      result,
      metadata: {
        message: op.metadata.message,
        prTitle: op.metadata.prTitle,
        agentId: op.metadata.agentId,
        agentName: op.metadata.agentName,
      },
    });
  }

  /**
   * Mark operation as failed. Emits git:op-failed event.
   */
  failOperation(operationId: string, error: string): void {
    const op = this.operations.get(operationId);
    if (!op) {
      logger.warn('Cannot fail: operation not found', { operationId });
      return;
    }

    // Idempotency guard: skip if already in terminal state
    if (op.status === 'completed' || op.status === 'failed') {
      logger.debug('Skipping failOperation: operation already in terminal state', {
        operationId,
        status: op.status,
      });
      return;
    }

    const now = Date.now();
    op.status = 'failed';
    op.completedAt = now;
    op.updatedAt = now;
    op.metadata.error = error;

    logger.info('Operation failed', { operationId, type: op.type });

    unifiedEventBus.emitDomainEvent('git:op-failed', {
      operationId,
      workspaceId: op.workspaceId,
      operationType: op.type,
      error,
      metadata: {
        message: op.metadata.message,
        prTitle: op.metadata.prTitle,
        agentId: op.metadata.agentId,
        agentName: op.metadata.agentName,
      },
    });
  }

  /**
   * Get all operations for a workspace.
   */
  getOperations(workspaceId: WorkspaceId): TrackedGitOperation[] {
    const ops: TrackedGitOperation[] = [];
    for (const op of this.operations.values()) {
      if (op.workspaceId === workspaceId) {
        ops.push(op);
      }
    }
    return ops;
  }

  /**
   * Clear completed operations for a workspace (or all if no workspaceId).
   */
  clearCompleted(workspaceId?: WorkspaceId): void {
    for (const [id, op] of this.operations.entries()) {
      if (op.status === 'completed' || op.status === 'failed') {
        if (!workspaceId || op.workspaceId === workspaceId) {
          this.operations.delete(id);
        }
      }
    }
    logger.debug('Cleared completed operations', { workspaceId: workspaceId ?? 'all' });
  }

  /**
   * Start the cleanup timer for auto-expiring completed operations.
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredOperations();
    }, CLEANUP_INTERVAL_MS);
    // Don't keep the event loop alive for cleanup
    this.cleanupTimer.unref();
  }

  /**
   * Dispose of resources (cleanup timer).
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Remove completed operations older than TTL.
   */
  private cleanupExpiredOperations(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, op] of this.operations.entries()) {
      if (
        (op.status === 'completed' || op.status === 'failed') &&
        op.completedAt &&
        now - op.completedAt > COMPLETED_OP_TTL_MS
      ) {
        this.operations.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired operations', { count: cleaned });
    }
  }
}

/** Singleton instance */
export const backgroundGitOpsService = BackgroundGitOpsService.getInstance();
