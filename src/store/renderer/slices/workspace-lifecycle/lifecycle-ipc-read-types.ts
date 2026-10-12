import type { SagaGenerator } from 'typed-redux-saga';
import type { Workspace } from '../../../../shared/types';
import type { GithubRepo } from '../../../../features/github-auth/types';
import type { InstalledEditor } from '../external-editors/external-editors-slice';
import type { PanelState } from '../panel-layout/panel-layout-types';

type EffectSelector<Args extends unknown[], Result> = {
  effect(...args: Args): SagaGenerator<Result>;
};

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
  invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
}
