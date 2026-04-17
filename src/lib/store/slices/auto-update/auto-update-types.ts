import type { UpdateChannel, UpdateInfo, UpdateProgress, UpdateStatus } from "$features/auto-update/types";

export type AutoUpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  channel: UpdateChannel;
  toastVisible: boolean;
  /** Timestamp (ms) when the user dismissed the "downloaded" toast. Null = never dismissed. */
  downloadedToastDismissedAt: number | null;
};

