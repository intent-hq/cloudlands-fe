import type { KnownRepo } from '../../../../shared/types/known-repo';
import type { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import type { SagaGenerator } from 'typed-redux-saga';
import type { Workspace } from '../../../../shared/types';
import type { GithubRepo } from '../../../../features/github-auth/types';
import type { InstalledEditor } from '../external-editors/external-editors-slice';
import type { PanelState } from '../panel-layout/panel-layout-types';

type EffectSelector<Args extends unknown[], Result> = {
  effect(...args: Args): SagaGenerator<Result>;
};

export type KnownReposResponse = { success: boolean; data?: KnownRepo[] };

/** Required capabilities of the existing lifecycle IPC owner; no branch receivers. */
export interface LifecycleIpcReadDependencies {
  selectPrincipalConnectionContext: EffectSelector<[], string | null>;
  selectInstalledEditors: EffectSelector<[], InstalledEditor[]>;
  selectInstalledEditorsLoading: EffectSelector<[], boolean>;
  selectLastFetched: EffectSelector<[], number>;
  selectPanels: EffectSelector<[workspaceId: string], Record<string, PanelState>>;
  selectMultiSelectSidebarSelectedTabIds: EffectSelector<[workspaceId: string], string[]>;
  selectWorkspaceById: EffectSelector<[workspaceId: string], Workspace | undefined>;
  selectIsWorkspaceHydrated: EffectSelector<[workspaceId: string], boolean>;
  githubAuthClient: { listRepos(page?: number, workspaceId?: string): Promise<GithubRepo[]> };
  externalEditorsClient: { detectInstalled(forceRefresh?: boolean): Promise<InstalledEditor[]> };
  invoke(
    channel: typeof IPC_CHANNELS.WORKSPACE.GET_RECENT_REPOSITORIES,
    options: Record<string, never>,
  ): Promise<KnownReposResponse>;
}
