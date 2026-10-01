import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { interceptSpecialistEditorLaunches } from './specialist-detail.fixture';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { LiveSpecialistsClient } from '$lib/client/live/live-specialists-client';
import { agentFactory } from '$features/agent/services/agent-factory';
import { agentCreationSaga } from '$store/renderer/slices/workspace-agents/sagas/agent-creation-saga';
import { createAgentWithSpecialistRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { notify } from '$lib/components/patterns/notify';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatus } from '$shared/types';
import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceCatalogSaga } from '$store/renderer/slices/provider-catalog/workspace-catalog-saga';
import {
  workspaceCatalogRequested,
  workspaceCatalogInvalidated,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
import {
  fetchEditorsSuccess,
  setEditorOrder,
  setOpenAction,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import type { SpecialistDef } from '$lib/client/app-client';

export function setupWorkspaceSpecialists(
  record: (key: string, value: string) => void,
  launchError: string,
) {
  const previous = store.state;
  admitLegacyPrincipal();
  const restoreEditorLaunch = interceptSpecialistEditorLaunches((request) =>
    record('opens', JSON.stringify(request)),
  );
  const bridge = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  const oldCreate = agentFactory.createAgent;
  const oldNotify = notify.error;
  const client = new LiveSpecialistsClient();
  const requests: unknown[] = [];
  let fail = false;
  let empty = false;
  const defs = (id?: string): SpecialistDef[] => [
    {
      id: 'shared',
      name: id === 'project-a' ? 'Project A' : id === 'project-b' ? 'Project B' : 'User shared',
      description: 'Imported review specialist',
      source: id ? 'project' : 'user',
      importedFrom: 'claude-code',
      prompt: id === 'project-a' ? 'Prompt A' : id === 'project-b' ? 'Prompt B' : 'User prompt',
      path: `/tmp/${id ?? 'user'}/.claude/agents/shared.md`,
      ...(id === 'project-b' ? { unsupportedFields: ['permissionMode'] } : {}),
    },
  ];
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      versions: { electron: 'preview' },
      on: () => 'preview',
      offById: () => {},
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'backend:request') {
          const req = args[0] as {
            method: string;
            params?: { workspaceId?: string; includeProject?: boolean };
          };
          if (req.method === 'specialist.list') {
            requests.push(req.params ?? {});
            record('requests', JSON.stringify(requests));
            if (!req.params?.includeProject)
              record('global-request', JSON.stringify(req.params ?? {}));
            if (fail) {
              record('refresh-status', 'failed');
              throw new Error('Temporary read failure');
            }
            record('refresh-status', 'loaded');
            return {
              ok: true,
              result: {
                specialists: empty
                  ? []
                  : defs(req.params?.includeProject ? req.params.workspaceId : undefined),
                ...(empty
                  ? {
                      importDiagnostics: [
                        {
                          path: '/tmp/project-b/.claude/agents/shared.md',
                          source: 'project',
                          code: 'invalid',
                          message: 'Repair frontmatter.',
                        },
                      ],
                    }
                  : {}),
              },
            };
          }
          return { ok: true, result: { providers: [], settings: [], servers: [] } };
        }
        record('opens', JSON.stringify({ channel, args }));
        return { success: true };
      },
    },
  });
  for (const id of ['project-a', 'project-b'])
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(id),
        title: id,
        path: `/tmp/${id}`,
        branch: 'preview',
        status: WorkspaceStatus.Active,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        ...PREVIEW_FIXTURE_TIMESTAMPS,
      }),
    );
  store.dispatch(
    setFileSpecialists(
      defs().map((d) => ({
        ...d,
        source: 'user' as const,
        model: '',
        behaviorPrompt: d.prompt ?? '',
        filePath: d.path ?? '',
      })),
    ),
  );
  store.dispatch(
    fetchEditorsSuccess(
      [
        {
          id: 'vscode',
          name: 'Visual Studio Code',
          shortLabel: 'VS Code',
          appName: 'Visual Studio Code',
          category: 'ide',
          handlerType: 'vscode',
          priority: 100,
          installed: true,
        },
      ],
      0,
    ),
  );
  store.dispatch(setEditorOrder(['vscode']));
  store.dispatch(setOpenAction('vscode'));
  agentFactory.createAgent = async () => ({
    success: false,
    error: launchError,
    cause: Object.assign(new Error(launchError), { rpcCode: -32602 }),
  });
  notify.error = ((message: unknown, options?: { description?: unknown }) => {
    record('feedback', `${message} ${options?.description ?? ''}`);
    return 'preview';
  }) as typeof notify.error;
  const stop = store.runSaga(agentCreationSaga);
  const stopCatalog = store.runSaga(workspaceCatalogSaga);
  return {
    async load(id?: string, mode?: 'fail' | 'empty') {
      fail = mode === 'fail';
      empty = mode === 'empty';
      if (mode) store.dispatch(workspaceCatalogInvalidated(false));
      if (!id) {
        await client.list();
        return;
      }
      store.dispatch(workspaceCatalogRequested(id));
    },
    launch() {
      store.dispatch(createAgentWithSpecialistRequested('project-a', 'shared'));
    },
    dispose() {
      restoreEditorLaunch();
      stop();
      stopCatalog();
      agentFactory.createAgent = oldCreate;
      notify.error = oldNotify;
      store.dispatch(setFileSpecialists(getItems(previous.specialists.fileSpecialists)));
      store.dispatch(
        fetchEditorsSuccess(
          getItems(previous.externalEditors.editors),
          previous.externalEditors.lastFetched,
        ),
      );
      store.dispatch(setEditorOrder(previous.externalEditors.editorOrder));
      store.dispatch(setOpenAction(previous.externalEditors.selectedAction));
      for (const id of ['project-a', 'project-b']) {
        store.dispatch(removeWorkspaceEntity(WorkspaceId(id)));
      }
      if (bridge) Object.defineProperty(window, 'electronAPI', bridge);
      else Reflect.deleteProperty(window, 'electronAPI');
    },
  };
}
