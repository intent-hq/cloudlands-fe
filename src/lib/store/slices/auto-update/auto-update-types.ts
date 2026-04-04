import type { UpdateChannel, UpdateInfo, UpdateProgress, UpdateStatus } from "$features/auto-update/types";

export type AutoUpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  channel: UpdateChannel;
  toastVisible: boolean;
};

