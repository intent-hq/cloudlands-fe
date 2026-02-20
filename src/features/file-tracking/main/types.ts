/**
 * Types for file tracking (Backend/Main Process)
 *
 * Re-exports common types from parent module and defines additional types
 * specific to the main process implementation.
 *
 * NOTE: The parent types.ts contains the canonical TrackedChange interface.
 * This file re-exports it and adds backend-specific types.
 */

// Import and re-export common types from parent module
import {
  ChangeStage,
  AgentAttribution,
  TrackedChange as FrontendTrackedChange,
  StageTransition as FrontendStageTransition,
  ChangeFilter as FrontendChangeFilter,
  FileStats,
  type FileChangeStatus,
} from '../types';

export { ChangeStage, AgentAttribution, FileStats };
export type { FileChangeStatus };

// Re-export the canonical TrackedChange from parent - this is the source of truth
export type TrackedChange = FrontendTrackedChange;
export type StageTransition = FrontendStageTransition;
export type ChangeFilter = FrontendChangeFilter;

// Note: FileChange interface is defined in features/workspace/change-detector.types.ts
// Import from there if needed: import type { FileChange } from '../../workspace/change-detector.types';

/**
 * Internal file tracking state
 */
export interface FileTrackingState {
  changes: TrackedChange[];
  transitions: StageTransition[];
  lastSync: Date | null;
  isDirty: boolean;
}

/**
 * Configuration options for file tracking
 */
export interface FileTrackingOptions {
  autoSync?: boolean;
  syncInterval?: number;
  excludePatterns?: string[];
}

// GitStatus is defined in:
// - shared/types.ts for general git status (FileStatus[] format)
// - workspace/main/change-detection/git-types.ts for change detection (staged/unstaged format)
// Import from the appropriate location based on your use case.

/**
 * Storage interface for file tracking persistence
 */
export interface FileTrackingStorageInterface {
  save(workspaceId: string, state: FileTrackingState): Promise<void>;
  load(workspaceId: string): Promise<FileTrackingState | null>;
  clear(workspaceId: string): Promise<void>;
}

// CommitInfo is defined in shared/types.ts - import from there if needed
