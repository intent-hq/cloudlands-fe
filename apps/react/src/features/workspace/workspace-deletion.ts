import { store } from '@/store';
import { createWorkspaceDeletionRuntime } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-deletion-factory';

/** One issuer shared by React domain clients and their deletion lifetime owners. */
export const {
  captureWorkspaceDeletion,
  currentWorkspaceDeletion,
  terminalWorkspaceDeletion,
  captureDeletionExpiry,
} = createWorkspaceDeletionRuntime(store);
export type { WorkspaceDeletion } from '../../../../../src/store/renderer/slices/workspace/utils/workspace-domain-client-types';
