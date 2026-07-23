/**
 * Change Detection Module
 *
 * Exports all change detection components.
 * These modules were extracted from the monolithic ChangeDetector
 * to improve maintainability and testability.
 */

export { GitOperationsSafe } from './git-operations-safe-wrapper';
export type { GitStatus, GitDiffResult } from './git-types';

export { ChangeProcessor } from './change-processor';
export type { FileChange, ProcessedChange } from './change-processor';

export { EventCoordinator } from './event-coordinator';
export type { EventStats } from './event-coordinator';

export { SnapshotManager } from './snapshot-manager';
export type { FileSnapshot, SnapshotDiff } from './snapshot-manager';
