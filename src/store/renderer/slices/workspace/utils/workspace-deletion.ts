import { store } from '../../../store';
import { createWorkspaceDeletionRuntime } from './workspace-deletion-factory';

/** Compatibility facade for existing callers until the Svelte renderer retires. */
export const {
  captureWorkspaceDeletion,
  currentWorkspaceDeletion,
  terminalWorkspaceDeletion,
  captureDeletionExpiry,
} = createWorkspaceDeletionRuntime(store);
export type { WorkspaceDeletion } from './workspace-domain-client-types';
