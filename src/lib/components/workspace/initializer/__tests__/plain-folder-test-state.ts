/**
 * Store setup for plain-folder (Labs) create tests: the Labs flag, a daemon
 * protocol version, settled forge auth and the workspace list.
 */
import type { Workspace } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { SystemStatusWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';
import {
  logoutCompleted,
  setGitHubAuthState,
} from '$store/renderer/slices/github-auth/github-auth-slice';
import {
  resetGitLabAdmission,
  setGitLabAuthStatus,
} from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { setLabsPlainFolderWorkspacesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';

const PLAIN_FOLDER_PROTOCOL = '15.3';

function setDaemonProtocol(protocolVersion: string): void {
  const payload: SystemStatusWirePayload = {
    running: true,
    listenMode: 'uds',
    transports: ['uds'],
    clients: 1,
    agents: 0,
    version: '0.0.0-test',
    uptimeSeconds: 1,
    protocolVersion,
    host: { os: 'macos', arch: 'arm64', hasDisplay: true, locality: 'local' },
  };
  appStore.dispatch(
    systemStatusSuccess(
      payload,
      new Date().toISOString(),
      selectDaemonConnectionGeneration.select(appStore.state),
    ),
  );
}

export function setPlainFolderLabs(
  enabled: boolean,
  protocolVersion = PLAIN_FOLDER_PROTOCOL,
): void {
  appStore.dispatch(setLabsPlainFolderWorkspacesEnabled(enabled));
  setDaemonProtocol(protocolVersion);
}

export function settleForgeAuth({ github = false, gitlab = false } = {}): void {
  appStore.dispatch(
    setGitHubAuthState({
      isAuthenticated: github,
      requiresDaemonAuth: false,
      user: null,
      needsScopeUpdate: false,
      oauthUrl: null,
    }),
  );
  appStore.dispatch(
    setGitLabAuthStatus({
      host: 'gitlab.com',
      isConfigured: gitlab,
      deviceGrantSupported: null,
      user: null,
      method: null,
    }),
  );
}

export function loadWorkspaces(workspaces: Workspace[]): void {
  appStore.dispatch(replaceWorkspaceList(workspaces));
  appStore.dispatch(setWorkspaceHasLoaded(true));
}

/** Back to a fresh, unsettled state with Labs off. */
export function resetPlainFolderState(): void {
  appStore.dispatch(setLabsPlainFolderWorkspacesEnabled(false));
  appStore.dispatch(logoutCompleted());
  appStore.dispatch(resetGitLabAdmission());
  appStore.dispatch(replaceWorkspaceList([]));
  appStore.dispatch(setWorkspaceHasLoaded(false));
}
