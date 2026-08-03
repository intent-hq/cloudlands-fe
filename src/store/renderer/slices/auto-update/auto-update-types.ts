import type { UpdateChannel, UpdateInfo, UpdateProgress, UpdateStatus } from "$features/auto-update/types";

export type AutoUpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  channel: UpdateChannel;
  /** Count of responding agents while status is waiting-for-idle; null otherwise. */
  respondingAgentCount: number | null;
  toastVisible: boolean;
  /** Timestamp (ms) when the user dismissed the "downloaded" toast. Null = never dismissed. */
  downloadedToastDismissedAt: number | null;
};

