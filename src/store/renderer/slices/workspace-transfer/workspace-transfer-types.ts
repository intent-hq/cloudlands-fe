/**
 * Workspace Transfer types
 *
 * Wire shapes for `workspace.transfer.plan` (PROTOCOL §5.1) — mirrors the
 * Rust vocabulary in intentd's `intent-core/src/transfer.rs` — plus the
 * renderer-local wizard state for the Transfer/Download modal (steps 1–2:
 * destination pick + plan confirm; execution is a later surface).
 */

/** Per-table row stats for one workspace-scoped table included in a transfer. */
export interface TransferTableStat {
  name: string;
  rowCount: number;
  /** Summed byte length of every column value — serialized-payload estimate. */
  approxBytes: number;
}

/** One asset file under `<assets_root>/<workspaceId>/` (id = file name). */
export interface TransferAsset {
  id: string;
  sizeBytes: number;
}

/**
 * Git state summary: checked-out branch, dirty paths (snapshotted as WIP
 * commits at export time), and sandbox branches riding in the bundle.
 * `hasRepository: false` means the archive will carry no bundle.
 */
export interface TransferGitSummary {
  hasRepository: boolean;
  branch?: string;
  dirtyFiles: string[];
  sandboxBranches: string[];
}

/** The versioned transfer manifest embedded in every export archive. */
export interface TransferManifest {
  formatVersion: number;
  creatingIntentdVersion: string;
  workspaceId: string;
  createdAt: string;
  tables: TransferTableStat[];
  assets: TransferAsset[];
  git: TransferGitSummary;
}

/**
 * A non-blocking pre-flight notice (e.g. running agents, uncommitted changes,
 * unmerged sandboxes). `code` is machine-readable and stable; `message` is
 * human-readable.
 */
export interface TransferWarning {
  code: string;
  message: string;
}

/**
 * `workspace.transfer.plan` result: manifest preview + size estimate.
 * `totalSizeBytes = dbRowBytes + assetBytes + estimatedGitBundleBytes`.
 */
export interface TransferPlan {
  manifest: TransferManifest;
  totalSizeBytes: number;
  dbRowBytes: number;
  assetBytes: number;
  estimatedGitBundleBytes: number;
  warnings: TransferWarning[];
}

/** Wire result envelope: `{ plan }`. */
export interface TransferPlanWireResult {
  plan: TransferPlan;
}

/**
 * Where the transfer goes: another connected backend, or a local file
 * download.
 */
export type TransferDestination =
  | { kind: 'server'; connectionId: string }
  | { kind: 'download' };

export type TransferStep = 'destination' | 'confirm';

export type TransferPlanStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface WorkspaceTransferState {
  /** Whether the transfer wizard modal is open. */
  open: boolean;
  /** Workspace being transferred; null while the modal is closed. */
  workspaceId: string | null;
  /** Title captured at open time (avoids a parameterized selector in the host). */
  workspaceTitle: string;
  step: TransferStep;
  destination: TransferDestination | null;
  planStatus: TransferPlanStatus;
  plan: TransferPlan | null;
  planError: string | null;
}
