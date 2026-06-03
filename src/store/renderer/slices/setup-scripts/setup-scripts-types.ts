/**
 * Setup Scripts Types
 *
 * Safe to import from any process (renderer, main, shared, preload).
 */

import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";

export type SetupScript = {
  id: string;
  name: string;
  content: string;
  repoPath?: string;
  projectType?: string;
  lastUsedAt: string;
  usageCount: number;
  createdAt: string;
};

export type SetupScriptsState = {
  scripts: Collection<SetupScript, "id">;
  pendingDeletions: Record<string, true>;
  isBannerDismissedGlobally: boolean;
  bannerDismissedByWorkspaceId: Record<string, true>;
};

