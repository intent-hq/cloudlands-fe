/**
 * Controlled IPC and principal inputs for the preview/component tests only.
 * The rendered component uses the real Store, selector, root saga,
 * LiveWorkspacesClient and repository-context/Electron-IPC transports.
 * No native daemon, provider, credentials or write permission is exercised.
 */
import { store } from '$store/renderer/store';
import { repositoryContextSaga } from '$store/renderer/slices/repository-context/sagas/repository-context-saga';
import {
  principalReceived,
  principalContextChanged,
} from '$store/renderer/slices/principal/principal-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, overrideMockIpcHandler } from '$shared/ipc-mock-router';
import type {
  RepositoryContext,
  RepositoryRootContext,
  RepositoryRootIdentity,
} from '$shared/types/repository-context';

import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import type { Workspace } from '$shared/types';
import type {
  SelectionPreview,
  SelectionObservation,
  SelectionCommand,
  SelectionRetirement,
} from '$shared/types/repository-selection';

export interface SelectionFixtureOptions {
  role?: 'owner' | 'member' | 'guest-owner' | 'collaborator' | 'stale-guest';
  saved?: SelectionPreview['snapshot']['selection'];
  delayCapture?: boolean;
  delayCommand?: boolean;
  refuseCapture?: boolean;
  result?: SelectionObservation | 'lost';
}

export type SummaryScene =
  | 'selection-edit'
  | 'selection-history'
  | 'selection-reset'
  | 'selection-uncertain'
  | 'selection-committed'
  | 'selection-conflict'
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
export function installSummaryFixture(
  scene: SummaryScene = 'self-managed',
  delayCapture = false,
  options: SelectionFixtureOptions = {},
) {
  const selectionScene = scene.startsWith('selection-');
  const selectionOptions: SelectionFixtureOptions = {
    ...(selectionScene ? { role: 'owner' as const } : {}),
    ...options,
  };
  const selectionCaptures: Array<{
    id: string;
    root: RepositoryRootIdentity;
    preview: SelectionPreview;
    finish(): void;
  }> = [];
  const selectionRequests: Array<{
    id: string;
    root: RepositoryRootIdentity;
    kind: 'confirm' | 'reconcile';
    command?: SelectionCommand;
    finish(value?: SelectionObservation): void;
    lose(): void;
  }> = [];
  const selectionReleases: string[] = [];
  const selectionChannels = IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION;
  function previewFor(root: RepositoryRootIdentity): SelectionPreview {
    return {
      root,
      scope: summaryContext(scene).scope,
      expiresAfterMs: 300000,
      snapshot: {
        root,
        rootIncarnation: '1',
        selectionRevision: '0',
        selection:
          selectionOptions.saved ??
          (scene === 'selection-history'
            ? {
                kind: 'saved',
                value: { mode: 'unresolved-historical', recordId: 'private-record' },
              }
            : scene === 'selection-reset'
              ? { kind: 'reset' }
              : { kind: 'neverSaved' }),
      },
    };
  }
  function requestSelection(raw: unknown, kind: 'confirm' | 'reconcile') {
    const { id, root, command } = raw as {
      id: string;
      root: RepositoryRootIdentity;
      command?: SelectionCommand;
    };
    let finish!: (value?: SelectionObservation) => void, lose!: () => void;
    const promise = new Promise((resolve, reject) => {
      finish = (value) =>
        resolve({
          ok: true,
          result: value ?? {
            current: true,
            uncertain: false,
            attempt: {
              status: 'settled',
              receipt: {
                result:
                  scene === 'selection-committed'
                    ? { kind: 'failed', code: 'admission-retired' }
                    : scene === 'selection-conflict'
                      ? { kind: 'conflict', snapshot: previewFor(root).snapshot }
                      : {
                          kind: 'applied',
                          snapshot: {
                            ...previewFor(root).snapshot,
                            selectionRevision: '1',
                            selection:
                              command?.kind === 'reset'
                                ? { kind: 'reset' }
                                : command?.kind === 'save'
                                  ? { kind: 'saved', value: command.choice }
                                  : { kind: 'reset' },
                          },
                        },
                persistence:
                  scene === 'selection-conflict'
                    ? { kind: 'noEffect' }
                    : { kind: 'committed', selectionRevision: '1' },
              },
            },
          },
        });
      lose = () => reject(new Error('Controlled response loss'));
    });
    selectionRequests.push({ id, root, command, kind, finish, lose });
    if (!selectionOptions.delayCommand) {
      if (
        selectionOptions.result === 'lost' ||
        (scene === 'selection-uncertain' && kind === 'confirm')
      )
        lose();
      else finish(selectionOptions.result);
    }
    return promise;
  }
  const previousBridge = window.electronAPI;
  const listeners = new Map<string, { channel: string; handler: (payload: unknown) => void }>();
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
    overrideMockIpcHandler(selectionChannels.CAPTURE, (raw) => {
      const { root } = raw as { root: RepositoryRootIdentity };
      const id = 'preview-selection-' + (selectionCaptures.length + 1);
      const preview = previewFor(root);
      let finish!: () => void;
      const promise = new Promise((resolve) => {
        finish = () =>
          resolve(
            selectionOptions.refuseCapture
              ? {
                  ok: false,
                  error: {
                    code: 'REPOSITORY_SELECTION_UNAVAILABLE',
                    message: 'Controlled capture refusal',
                  },
                }
              : { ok: true, result: { id, preview } },
          );
      });
      selectionCaptures.push({ id, root, preview, finish });
      if (!selectionOptions.delayCapture) finish();
      return promise;
    }),
    overrideMockIpcHandler(selectionChannels.CONFIRM, (raw) => requestSelection(raw, 'confirm')),
    overrideMockIpcHandler(selectionChannels.RECONCILE, (raw) =>
      requestSelection(raw, 'reconcile'),
    ),
    overrideMockIpcHandler(selectionChannels.RELEASE, (raw) => {
      selectionReleases.push((raw as { id: string }).id);
      return { ok: true, result: { released: true } };
    }),
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
      if (channel !== channels.RETIRED && channel !== selectionChannels.RETIRED)
        throw new Error(`Unexpected preview event: ${channel}`);
      const id = String(++listenerId);
      listeners.set(id, { channel, handler });
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
    if (selectionOptions.role) grant(selectionOptions.role);
  }
  function grant(role: NonNullable<SelectionFixtureOptions['role']>) {
    store.dispatch(setLabsMultiplayerEnabled(true));
    const p = store.state.principal;
    if (!p.context || !p.snapshot) throw new Error('Preview admission required');
    store.dispatch(
      principalReceived(
        {
          context: p.context,
          invalidation: p.invalidation,
          presentationVersion: p.presentationVersion,
        },
        {
          ...p.snapshot,
          capabilities: { ...p.snapshot.capabilities, hostMembership: true },
          principal: {
            ...p.snapshot.principal,
            hostRole: role === 'owner' ? 'owner' : role === 'member' ? 'member' : 'guest',
            isAdministrator: role === 'owner',
            hostMembershipRevision: 1,
          },
        },
      ),
    );
    store.dispatch(
      setWorkspaceEntity({
        id: previewWorkspaceId,
        title: 'Repository details',
        branch: 'feature/details',
        myRole: role === 'collaborator' ? 'collaborator' : 'owner',
        canManage: role !== 'collaborator',
      } as Workspace),
    );
    store.dispatch(
      setWorkspaceHasLoaded(
        true,
        store.state.connections.windowBackendId,
        role === 'stale-guest'
          ? 'previous-admission'
          : selectPrincipalAdmissionContext.select(store.state),
      ),
    );
  }
  admit('host-A');
  if (scene === 'inactive') store.dispatch(principalContextChanged(null));
  const stop = store.runSaga(repositoryContextSaga);
  return {
    selectionCaptures,
    selectionRequests,
    selectionReleases,
    grant,
    retireSelection(kind: SelectionRetirement = 'admission', index = selectionCaptures.length - 1) {
      const id = selectionCaptures[index]?.id;
      for (const listener of listeners.values())
        if (listener.channel === selectionChannels.RETIRED) listener.handler({ id, kind });
    },
    captures,
    reads,
    releases,
    admit,
    retire(index = captures.length - 1) {
      const id = captures[index]?.id;
      for (const listener of listeners.values())
        if (listener.channel === channels.RETIRED) listener.handler({ id });
    },
    dispose() {
      stop();
      store.dispatch(principalContextChanged(null));
      cleanups.reverse().forEach((cleanup) => cleanup());
      if (window.electronAPI === bridge) window.electronAPI = previousBridge;
    },
  };
}
