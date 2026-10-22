import type { ScriptWithState } from '$features/scripts/types';
import { store } from '$store/renderer/store';
import { principalReceived } from '$store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  appendScriptOutput,
  setActiveScriptsData,
  setScriptListState,
  setScriptsInitialized,
} from '$store/renderer/slices/scripts/scripts-slice';
import { loadWorkspaceTerminals } from '$store/renderer/slices/terminals/terminals-slice';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';

export const managerShellWorkspace = 'preview-manager-shell';
export const managerShellScripts = {
  service: 'manager-saved-service',
  command: 'manager-saved-command',
  oneOff: 'manager-one-off',
};
export const managerShellTerminal = 'manager-raw-terminal';
const createdAt = '2026-10-21T12:00:00Z';

/** Reducer-only data: no transport, mocked permission selectors, or execution sagas. */
export function seedManagerShellAccess(): void {
  store.dispatch(setLabsMultiplayerEnabled(true));
  admitLegacyPrincipal('guest');
  const principal = store.state.principal;
  if (!principal.context || !principal.snapshot)
    throw new Error('Preview principal was not admitted');
  store.dispatch(
    principalReceived(
      {
        context: principal.context,
        invalidation: principal.invalidation,
        presentationVersion: principal.presentationVersion,
      },
      {
        ...principal.snapshot,
        principal: {
          ...principal.snapshot.principal,
          hostRole: 'guest',
          isAdministrator: false,
          hostMembershipRevision: 1,
        },
        capabilities: {
          ...principal.snapshot.capabilities,
          hostMembership: true,
          workspaceGuestRoles: true,
        },
      },
    ),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  const definitions: Omit<ScriptWithState, 'workspaceId' | 'source' | 'createdAt'>[] = [
    {
      id: managerShellScripts.service,
      name: 'Preview server',
      command: 'pnpm dev',
      mode: 'service',
      purpose: 'saved',
      runtime: { status: 'running', restartCount: 0, startedAt: createdAt },
    },
    {
      id: managerShellScripts.command,
      name: 'Check project',
      command: 'pnpm check',
      mode: 'command',
      purpose: 'saved',
      runtime: { status: 'idle', restartCount: 0 },
    },
    {
      id: managerShellScripts.oneOff,
      name: 'Private one-off command',
      command: 'printenv',
      mode: 'command',
      purpose: 'oneOff',
      runtime: { status: 'running', restartCount: 0 },
    },
  ];
  const scripts: ScriptWithState[] = definitions.map((script) => ({
    ...script,
    workspaceId: managerShellWorkspace,
    source: 'user',
    createdAt,
  }));
  store.dispatch(setActiveScriptsData(managerShellWorkspace, scripts));
  store.dispatch(setScriptsInitialized(managerShellWorkspace, true));
  store.dispatch(setScriptListState(managerShellWorkspace, false));
  store.dispatch(
    appendScriptOutput(managerShellWorkspace, managerShellScripts.service, {
      text: 'VITE ready in 248 ms\r\n\r\n  Local: http://localhost:5173/\r\n\r\n  Watching for file changes…\r\n',
      timestamp: createdAt,
    }),
  );
  store.dispatch(
    appendScriptOutput(managerShellWorkspace, managerShellScripts.oneOff, {
      text: 'PRIVATE_ONE_OFF_OUTPUT\r\n',
      timestamp: createdAt,
    }),
  );
  store.dispatch(
    loadWorkspaceTerminals(
      managerShellWorkspace,
      [
        {
          id: managerShellTerminal,
          name: 'Private raw terminal',
          workspaceId: managerShellWorkspace,
          createdAt,
        },
      ],
      { isOpen: false, activeTerminalId: managerShellTerminal },
      'manager-shell-preview',
    ),
  );
}

export function setManagerShellRole(role: 'manager' | 'collaborator'): void {
  store.dispatch(
    setWorkspaceEntity({
      id: managerShellWorkspace,
      title: 'Intent Site',
      path: '/tmp/preview-manager-shell',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      ownerPrincipalId: 'another-owner',
      myRole: role,
      canManage: false,
      canPrompt: true,
    } as never),
  );
}
