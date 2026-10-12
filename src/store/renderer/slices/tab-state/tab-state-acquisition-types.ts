import type { TabState } from './tab-state-slice';

/** Accepted acquisition history, not another copy of tab membership. Never persisted. */
export type WorkspaceTabAcquisitions = {
  lastSerial: number;
  serialByWorkspaceId: Record<string, number>;
};

export type AcquiredTabState = TabState & {
  workspaceTabAcquisitions: WorkspaceTabAcquisitions;
};
