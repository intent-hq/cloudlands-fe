import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

type WorkspaceCreationRepoType = 'local' | 'github' | 'remote';

export interface WorkspaceCreationRemoteSetup {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  keyPath?: string;
  useAgent?: boolean;
  workspacePath: string;
  lastUsedRepo?: string;
  lastUsed?: string;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
  branch?: string;
}

export interface WorkspaceCreationRepoSelection {
  path: string;
  type: WorkspaceCreationRepoType;
  githubUrl?: string;
  isNewRepo?: boolean;
  isValidPath?: boolean;
  scope?: string;
  remoteSetup?: WorkspaceCreationRemoteSetup;
}

export interface WorkspaceCreationRecentRepo {
  path: string;
  type: 'local' | 'github';
  githubUrl?: string;
  name: string;
  owner?: string;
}

export interface WorkspaceCreationSettingsHydrationState {
  lastSelectedRepo?: WorkspaceCreationRepoSelection | null;
  branchByRepo?: Record<string, string>;
  defaultParentPath?: string;
  recentRepos?: WorkspaceCreationRecentRepo[];
  remoteSetups?: WorkspaceCreationRemoteSetup[];
}

export interface WorkspaceCreationSettingsState {
  hydrated: boolean;
  lastSelectedRepo: WorkspaceCreationRepoSelection | null;
  branchByRepo: Record<string, string>;
  defaultParentPath: string;
  recentRepos: Collection<WorkspaceCreationRecentRepo, 'path'>;
  remoteSetups: Collection<WorkspaceCreationRemoteSetup, 'id'>;
}
