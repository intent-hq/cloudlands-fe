/** Controlled component boundary only: real Store/root saga/Live client and IPC facade. */
import {
  installSummaryFixture,
  summaryContext,
  previewWorkspaceId,
  type SelectionFixtureOptions,
  type SummaryScene,
} from './repository-context-summary.preview-fixtures';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import type {
  NativeReviewInput,
  NativeReviewPreparedView,
  NativeReviewObservation,
  NativeReviewTextCommand,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import type {
  NativeReviewExecution,
  NativeReviewPublication,
  NativeReviewOutcome,
} from '$shared/types/native-review';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';

export type NativeScene =
  'created' | 'reused' | 'uncertain' | 'failed' | 'pending' | 'not-attempted';
export interface NativeFixtureOptions {
  scene?: NativeScene;
  context?: SummaryScene;
  role?: SelectionFixtureOptions['role'];
  delayRead?: boolean;
  delayPrepare?: boolean;
  refusePrepare?: boolean;
  invalidPrepare?: boolean;
  delayCommand?: boolean;
}
export const nativeRoot: RepositoryRootIdentity = {
  workspaceId: previewWorkspaceId,
  kind: 'primary',
};
const repository = {
  provider: 'gitlab' as const,
  instanceBaseUrl: 'https://forge.example:8443/platform/gitlab',
  projectPath: 'engineering/tools/editor',
};

export function nativePreview(
  root = nativeRoot,
  id = 'native-preview-1',
): NativeReviewPreparedView {
  return {
    root,
    valid: true,
    warnings: [],
    errors: [],
    suggestedPRTitle: 'Suggested request',
    suggestedPRBody: 'Suggested details',
    filesCount: 0,
    additions: 0,
    deletions: 0,
    files: [],
    expiresAfterMs: 300000,
    reviewPreparation: {
      operationId: id,
      root,
      scope: summaryContext('self-managed').scope,
      contextRevision: { epoch: id, sequence: '1' },
      worktreeId: 'original-worktree',
      source: { repository, providerProjectId: '42', branch: 'feature/details' },
      target: { repository, providerProjectId: '42', branch: 'main' },
      localHeadSha: 'local-B',
      transport: null,
    },
  };
}
export function nativeObservation(
  scene: NativeScene = 'reused',
  root = nativeRoot,
  id = 'native-preview-1',
): NativeReviewObservation {
  if (scene === 'pending')
    return {
      current: false,
      uncertain: true,
      reconciliation: null,
      execute: { operationId: id, root, state: 'pending', success: false, steps: [] },
    };
  const actualReview = {
    resource: { repository, kind: 'merge-request' as const, number: 27 },
    url: 'https://forge.example/groups/editor/-/merge_requests/27',
    title: 'Actual remote review title',
    body: null,
    state: null,
    draft: null,
    sourceBranch: null,
    targetBranch: null,
    source: null,
    target: null,
    author: null,
    mergeable: null,
    mergeableState: null,
    headSha: 'remote-A',
    createdAt: null,
    updatedAt: null,
  };
  const outcome: NativeReviewOutcome =
    scene === 'created' || scene === 'reused'
      ? { status: scene, review: actualReview }
      : scene === 'not-attempted'
        ? { status: scene }
        : scene === 'failed'
          ? {
              status: scene,
              stage: 'create-pr',
              message: 'Provider result unavailable',
              code: null,
            }
          : {
              status: scene,
              stage: 'create-pr',
              message: 'Provider result unavailable',
            };
  const execution: NativeReviewExecution = {
    requestId: id,
    preparation: nativePreview(root, id).reviewPreparation,
    outcome,
    gitReceipts: scene === 'failed' ? [{ stage: 'commit', commitHash: 'completed-B' }] : [],
    publication: { state: 'local-ahead', localHeadSha: 'local-B', remoteSourceSha: 'remote-A' },
  };
  return {
    current: false,
    uncertain: scene === 'uncertain',
    reconciliation: null,
    execute: {
      operationId: id,
      root,
      state: 'settled',
      reviewExecution: execution,
      success: scene === 'created' || scene === 'reused',
      steps: [],
      ...(scene === 'failed' ? { error: 'Original execution failed' } : {}),
    },
  };
}
export function withPublication(publication: NativeReviewPublication): NativeReviewObservation {
  const result = nativeObservation();
  if (result.execute?.reviewExecution) result.execute.reviewExecution.publication = publication;
  return result;
}

export function installNativeFixture(options: NativeFixtureOptions = {}) {
  const base = installSummaryFixture(options.context ?? 'self-managed', options.delayRead, {
    role: options.role ?? 'owner',
  });
  const previousBridge = window.electronAPI;
  const listeners = new Map<string, (payload: unknown) => void>();
  const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
  let serial = 0;
  const bridge = {
    ...previousBridge,
    on(channel: string, handler: (payload: unknown) => void) {
      if (channel !== channels.RETIRED) return previousBridge.on(channel, handler);
      const id = 'native-listener-' + ++serial;
      listeners.set(id, handler);
      return id;
    },
    offById(channel: string, id: string) {
      if (channel === channels.RETIRED) listeners.delete(id);
      else previousBridge.offById(channel, id);
    },
  } as Window['electronAPI'];
  window.electronAPI = bridge;
  const captures: Array<{
    id: string;
    input: NativeReviewInput;
    preview: NativeReviewPreparedView;
    finish(): void;
  }> = [];
  const requests: Array<{
    id: string;
    root: RepositoryRootIdentity;
    kind: 'execute' | 'reconcile';
    command?: NativeReviewTextCommand;
    finish(value?: NativeReviewObservation): void;
    lose(): void;
  }> = [];
  const releases: Array<{ id: string; root: RepositoryRootIdentity }> = [];
  const legacyRequests: Array<{ method: string }> = [];
  function retire(kind: NativeReviewRetirement = 'admission', index = captures.length - 1) {
    const id = captures[index]?.id;
    for (const handler of listeners.values()) handler({ id, kind });
  }
  function request(raw: unknown, kind: 'execute' | 'reconcile') {
    const { id, root, command } = raw as {
      id: string;
      root: RepositoryRootIdentity;
      command?: NativeReviewTextCommand;
    };
    let finish!: (value?: NativeReviewObservation) => void, lose!: () => void;
    const promise = new Promise((resolve, reject) => {
      finish = (value) => {
        let result = value ?? nativeObservation(options.scene ?? 'reused', root, id);
        if (kind === 'reconcile' && !value) {
          const execution = nativeObservation('reused', root, id).execute;
          result = {
            current: false,
            uncertain: false,
            execute: nativeObservation(options.scene ?? 'reused', root, id).execute,
            reconciliation: {
              operationId: id,
              root,
              state: 'settled',
              reviewExecution: execution?.reviewExecution,
            },
          };
        }
        if (!result.current)
          retire(
            'admission',
            captures.findIndex((c) => c.id === id),
          );
        resolve({ ok: true, result });
      };
      lose = () => reject(new Error('Controlled response loss'));
    });
    requests.push({ id, root, kind, command, finish, lose });
    if (!options.delayCommand) finish();
    return promise;
  }
  const cleanups = [
    overrideMockIpcHandler(channels.PREPARE, (raw) => {
      const { input } = raw as { input: NativeReviewInput };
      const id = 'native-preview-' + (captures.length + 1);
      const preview = nativePreview(input.review.root, id);
      if (options.invalidPrepare) {
        preview.valid = false;
        preview.errors = ['Preparation refused'];
      }
      let finish!: () => void;
      const promise = new Promise((resolve) => {
        finish = () =>
          resolve(
            options.refusePrepare
              ? {
                  ok: false,
                  error: {
                    code: 'NATIVE_REVIEW_UNAVAILABLE',
                    message: 'Controlled preparation refusal',
                  },
                }
              : { ok: true, result: { id, preview } },
          );
      });
      captures.push({ id, input, preview, finish });
      if (!options.delayPrepare) finish();
      return promise;
    }),
    overrideMockIpcHandler(channels.EXECUTE, (raw) => request(raw, 'execute')),
    overrideMockIpcHandler(channels.RECONCILE, (raw) => request(raw, 'reconcile')),
    overrideMockIpcHandler(channels.RELEASE, (raw) => {
      releases.push(raw as { id: string; root: RepositoryRootIdentity });
      return { ok: true, result: { released: true } };
    }),
    overrideMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (raw) => {
      const query = raw as { method: string };
      legacyRequests.push(query);
      if (query.method === 'accept-changes.prepare')
        return {
          ok: true,
          result: {
            valid: true,
            warnings: [],
            errors: [],
            suggestedPRTitle: 'Legacy title',
            suggestedPRBody: 'Legacy body',
            filesCount: 0,
            additions: 0,
            deletions: 0,
            files: [],
          },
        };
      return {
        ok: true,
        result: { success: false, steps: [], error: 'Controlled legacy failure' },
      };
    }),
  ];
  return {
    base,
    captures,
    requests,
    releases,
    legacyRequests,
    retire,
    dispose() {
      cleanups.reverse().forEach((stop) => stop());
      if (window.electronAPI === bridge) window.electronAPI = previousBridge;
      base.dispose();
    },
  };
}
