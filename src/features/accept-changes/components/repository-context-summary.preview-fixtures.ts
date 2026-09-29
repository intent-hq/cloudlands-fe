/**
 * Controlled IPC and principal inputs for the preview/component tests only.
 * The rendered component uses the real Store, selector, root saga,
 * LiveWorkspacesClient and repository-context/Electron-IPC transports.
 * No native daemon, provider, credentials or write permission is exercised.
 */
import { store } from '$store/renderer/store';
import { repositoryContextSaga } from '$store/renderer/slices/repository-context/sagas/repository-context-saga';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import type {
  RepositoryContext,
  RepositoryRootContext,
  RepositoryRootIdentity,
} from '$shared/types/repository-context';

export type SummaryScene =
  | 'github'
  | 'self-managed'
  | 'unknown'
  | 'history'
  | 'missing-remote'
  | 'selection-required'
  | 'no-remote'
  | 'migrated'
  | 'unavailable'
  | 'inactive'
  | 'loading'
  | 'long';
export const previewWorkspaceId = 'repository-summary-preview';

export function summaryContext(
  scene: SummaryScene,
  workspaceId = previewWorkspaceId,
): RepositoryContext {
  const target =
    scene === 'github'
      ? {
          provider: 'github' as const,
          instanceBaseUrl: 'https://github.com',
          projectPath: 'acme/editor',
        }
      : {
          provider: 'gitlab' as const,
          instanceBaseUrl: 'https://forge.example:8443/platform/gitlab',
          projectPath:
            scene === 'long'
              ? 'research/observability/team-with-a-very-long-name/project-with-a-very-long-name'
              : 'engineering/tools/editor',
        };
  const primary: RepositoryRootContext = {
    root: { workspaceId, kind: 'primary' },
    ...(scene === 'unknown'
      ? {}
      : {
          branch:
            scene === 'long'
              ? 'feature/retain-original-repository-details-after-a-very-long-operation'
              : 'feature/details',
        }),
    headSha: 'fixture-sha-never-rendered',
    remotes: [
      {
        name: 'origin',
        fetch: [
          {
            url: 'https://fixture-user:fixture-secret@forge.example/private.git',
            resolution: { state: 'resolved', target },
          },
        ],
        push: [],
      },
    ],
    targets: [
      { target, availability: scene === 'unknown' ? 'unknown' : 'connected', capabilities: [] },
    ],
    reviewSelection: {
      saved: { mode: 'automatic' },
      noRemotes: false,
      outcome: { state: 'resolved', target, source: 'automatic' },
    },
  };
  if (scene === 'history')
    primary.reviewSelection = {
      saved: { mode: 'unresolved-historical', recordId: 'private-record' },
      noRemotes: false,
      outcome: { state: 'selection-required', reason: 'unresolved-historical-choice' },
    };
  if (scene === 'missing-remote')
    primary.reviewSelection = {
      saved: { mode: 'explicit-remote', remoteName: 'upstream-old' },
      noRemotes: false,
      outcome: { state: 'selection-required', reason: 'missing-selected-remote' },
    };
  if (scene === 'selection-required')
    primary.reviewSelection.outcome = { state: 'selection-required', reason: 'ambiguous-targets' };
  if (scene === 'no-remote') {
    primary.remotes = [];
    primary.targets = [];
    primary.reviewSelection = {
      saved: { mode: 'automatic' },
      noRemotes: true,
      outcome: { state: 'repository-unavailable', reason: 'no-remote', selectionRequired: false },
    };
  }
  if (scene === 'migrated')
    primary.reviewSelection = {
      saved: {
        mode: 'migrated-canonical',
        target,
        provenance: {
          source: 'workspace-metadata',
          recordId: 'private-record',
          resolverVersion: 'fixture',
          evidenceId: 'private-evidence',
        },
      },
      noRemotes: false,
      outcome: { state: 'resolved', target, source: 'migrated-canonical' },
    };
  return {
    scope: { daemonId: 'host-A', authorityScopeId: 'guest', authorityGeneration: '1' },
    revision: { epoch: 'preview-lease', sequence: '1' },
    roots: [
      primary,
      {
        ...primary,
        root: { workspaceId, kind: 'registered', gitRootId: 'tools' },
        branch: 'tools/maintenance',
      },
    ],
  };
}

/** Caller initializes the real Store first; this fixture starts only the one production root saga. */
export function installSummaryFixture(scene: SummaryScene = 'self-managed', delayCapture = false) {
  const previousBridge = window.electronAPI;
  const listeners = new Map<string, (payload: unknown) => void>();
  const captures: Array<{ id: string; root: RepositoryRootIdentity; finish(): void }> = [];
  const reads: Array<{
    id: string;
    method: string;
    params: Record<string, unknown>;
    finish(context?: RepositoryContext): void;
  }> = [];
  const releases: string[] = [];
  const channels = IPC_CHANNELS.BACKEND.REPOSITORY;
  const cleanups = [
    overrideMockIpcHandler(channels.CAPTURE, (raw) => {
      const { root } = raw as { root: RepositoryRootIdentity };
      const id = `preview-route-${captures.length + 1}`;
      let finish!: () => void;
      const promise = new Promise((resolve) => {
        finish = () => resolve({ ok: true, result: { id } });
      });
      captures.push({ id, root, finish });
      if (!delayCapture) finish();
      return promise;
    }),
    overrideMockIpcHandler(channels.REQUEST, (raw) => {
      const { id, method, params } = raw as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      let finish!: (context?: RepositoryContext) => void;
      const promise = new Promise((resolve) => {
        finish = (context = summaryContext(scene, String(params.workspaceId))) =>
          resolve({
            ok: true,
            result: {
              operationId: id,
              current: true,
              settlement:
                scene === 'unavailable'
                  ? {
                      status: 'rejected',
                      error: { code: 'unavailable', message: 'Controlled read failure' },
                    }
                  : {
                      status: 'fulfilled',
                      value: { ...context, revision: { ...context.revision, epoch: id } },
                    },
            },
          });
      });
      reads.push({ id, method, params, finish });
      if (scene !== 'loading') finish();
      return promise;
    }),
    overrideMockIpcHandler(channels.RELEASE, (raw) => {
      releases.push((raw as { id: string }).id);
      return { ok: true, result: { released: true } };
    }),
  ];
  let listenerId = 0;
  const bridge = {
    versions: { electron: '0.0.0-browser' },
    invoke: mockInvoke,
    on(channel: string, handler: (payload: unknown) => void) {
      if (channel !== channels.RETIRED) throw new Error(`Unexpected preview event: ${channel}`);
      const id = String(++listenerId);
      listeners.set(id, handler);
      return id;
    },
    offById(_channel: string, id: string) {
      listeners.delete(id);
    },
  } as unknown as Window['electronAPI'];
  window.electronAPI = bridge;
  function admit(backendId: string) {
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: backendId, windowBackendId: backendId }),
    );
    admitLegacyPrincipal('guest');
  }
  admit('host-A');
  if (scene === 'inactive') store.dispatch(principalContextChanged(null));
  const stop = store.runSaga(repositoryContextSaga);
  return {
    captures,
    reads,
    releases,
    admit,
    retire(index = captures.length - 1) {
      const id = captures[index]?.id;
      for (const handler of listeners.values()) handler({ id });
    },
    dispose() {
      stop();
      store.dispatch(principalContextChanged(null));
      cleanups.reverse().forEach((cleanup) => cleanup());
      if (window.electronAPI === bridge) window.electronAPI = previousBridge;
    },
  };
}
