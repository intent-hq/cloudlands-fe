/**
 * Bulk workspace transfer (Home multi-select → another machine).
 *
 * Runs the single-workspace relay (`transfer:start` + `transfer:finalize`)
 * once per workspace, in order. The options are chosen up front and applied
 * to every finalize; the renderer tracks one aggregate progress bar.
 */

import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { TransferProgress } from '../workspace-transfer/workspace-transfer-types';

export type BulkTransferStep = 'setup' | 'transferring' | 'result';

type BulkTransferItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

type BulkTransferSizeStatus = 'loading' | 'loaded' | 'error';

export interface BulkTransferItem {
  workspaceId: string;
  title: string;
  sizeStatus: BulkTransferSizeStatus;
  /** `workspace.transfer.plan` `totalSizeBytes`, once loaded. */
  sizeBytes: number | null;
  status: BulkTransferItemStatus;
  error: string | null;
}

export interface WorkspaceBulkTransferState {
  open: boolean;
  step: BulkTransferStep;
  /** Selected workspaces, in transfer order. */
  items: Collection<BulkTransferItem, 'workspaceId'>;
  /** Destination connection; bulk transfers always go to another machine. */
  connectionId: string | null;
  restartAgents: boolean;
  archiveSource: boolean;
  /** Workspace the relay is working on. */
  currentId: string | null;
  /** Relay counters for `currentId`. */
  progress: TransferProgress | null;
  /** Cancel was requested; the run stops before the next workspace. */
  cancelling: boolean;
}
