/** Controlled replies only. Components, Store, root workers and Live transports are production. */
import { store } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import {
  installSummaryFixture,
  summaryContext,
  previewWorkspaceId,
  type SelectionFixtureOptions,
  type SummaryScene,
} from './repository-context-summary.preview-fixtures';
import { nativeObservation, type NativeScene } from './native-review-attempt.preview-fixtures';
import type {
  NativeReviewInput,
  NativeReviewPreparedView,
  NativeReviewObservation,
  NativeReviewTextCommand,
  NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';
import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { acceptChangesStatusSaga } from '$store/renderer/slices/git/sagas/accept-changes-status-saga';
import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

export { previewWorkspaceId as sidebarWorkspaceId };
export interface SidebarFixtureOptions {
  scene?: NativeScene;
  role?: SelectionFixtureOptions['role'];
  context?: SummaryScene;
  baseRef?: string;
  /** Deliver origin-only status independently of the saved named-remote context read. */
  withoutOrigin?: boolean;
  delayStatus?: boolean;
  delayPrepare?: boolean;
  delayCommand?: boolean;
  refusePrepare?: boolean;
  refuseChild?: boolean;
  refuseCheck?: boolean;
  onBoundary?: (transcript: string) => void;
}
export function installSidebarNativeFixture(options: SidebarFixtureOptions = {}) {
  const base = installSummaryFixture(
    options.withoutOrigin ? 'loading' : (options.context ?? 'self-managed'),
    false,
    {
      role: options.role ?? 'owner',
    },
  );
  store.dispatch(
    setWorkspaceEntity({
      ...selectWorkspaceById.select(store.state, previewWorkspaceId)!,
      baseRef: options.baseRef,
    }),
  );
  store.dispatch(openWorkspaceTab(previewWorkspaceId));
  const previous = window.electronAPI;
  const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
  const listeners = new Map<string, (value: unknown) => void>();
  let serial = 0;
  const bridge = {
    ...previous,
    on(channel: string, callback: (value: unknown) => void) {
      if (channel !== channels.RETIRED) return previous.on(channel, callback);
      const id = 'sidebar-native-' + ++serial;
      listeners.set(id, callback);
      return id;
    },
    offById(channel: string, id: string) {
      if (channel === channels.RETIRED) listeners.delete(id);
      else previous.offById(channel, id);
    },
  } as Window['electronAPI'];
  window.electronAPI = bridge;
  const transcript: Array<{ channel: string; payload: unknown }> = [];
  const record = (channel: string, payload: unknown) => {
    transcript.push({ channel, payload: structuredClone(payload) });
    options.onBoundary?.(JSON.stringify(transcript));
  };
  const captures: Array<{
    id: string;
    input?: NativeReviewInput;
    companionOf?: string;
    root: RepositoryRootIdentity;
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
  const releases: string[] = [];
  const readRequests: Array<{ method: string; params?: unknown }> = [];
  const statusReplies: Array<{ finish(): void }> = [];
  const pending = new Set<Promise<unknown>>();
  function track<T>(promise: Promise<T>) {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }
  function retire(kind: NativeReviewRetirement, index = 0) {
    for (const listener of listeners.values()) listener({ id: captures[index]?.id, kind });
  }
  function result(id: string, kind: 'execute' | 'reconcile'): NativeReviewObservation {
    const capture = captures.find((c) => c.id === id);
    if (!capture) throw new Error('Command must name an original capture');
    if (!capture.companionOf) {
      const observation = nativeObservation('reused', capture.root, id);
      const execute = observation.execute!;
      execute.success = true;
      execute.reviewExecution = {
        ...execute.reviewExecution!,
        preparation: capture.preview.reviewPreparation,
        outcome: { status: 'not-attempted' },
        gitReceipts: [{ stage: 'commit', commitHash: 'staged-parent-B' }],
      };
      return { ...observation, current: true };
    }
    const observation = nativeObservation(options.scene ?? 'created', capture.root, id);
    if (observation.execute?.reviewExecution) {
      observation.execute.reviewExecution.preparation = capture.preview.reviewPreparation;
      observation.execute.reviewExecution.gitReceipts = [];
    }
    if (kind === 'reconcile') {
      const checked = nativeObservation('reused', capture.root, id).execute!;
      checked.reviewExecution!.preparation = capture.preview.reviewPreparation;
      observation.uncertain = false;
      observation.reconciliation = {
        operationId: id,
        root: capture.root,
        state: 'settled',
        reviewExecution: checked.reviewExecution,
      };
    }
    return observation;
  }
  function command(raw: unknown, kind: 'execute' | 'reconcile') {
    record(kind, raw);
    const { id, root, command } = raw as {
      id: string;
      root: RepositoryRootIdentity;
      command?: NativeReviewTextCommand;
    };
    let finish!: (value?: NativeReviewObservation) => void, lose!: () => void;
    const promise = track(
      new Promise((resolve, reject) => {
        finish = (value) =>
          resolve(
            options.refuseCheck && kind === 'reconcile'
              ? {
                  ok: false,
                  error: { code: 'NATIVE_REVIEW_UNAVAILABLE', message: 'Original check refused' },
                }
              : { ok: true, result: value ?? result(id, kind) },
          );
        lose = () => reject(new Error('Controlled original response loss'));
      }),
    );
    requests.push({ id, root, kind, command, finish, lose });
    if (!options.delayCommand) finish();
    return promise;
  }
  const cleanups = [
    overrideMockIpcHandler(channels.PREPARE, (raw) => {
      record('prepare', raw);
      const {
        input,
        companionOf,
        root: childRoot,
      } = raw as { input?: NativeReviewInput; companionOf?: string; root?: RepositoryRootIdentity };
      const parent = companionOf ? captures.find((c) => c.id === companionOf) : undefined;
      if (
        companionOf
          ? !parent || parent.companionOf || !childRoot
          : !input ||
            input.action !== 'commit' ||
            input.review.companion?.kind !== 'create-pr' ||
            input.files !== undefined ||
            input.options !== undefined ||
            input.review.pushRemote !== undefined
      )
        throw new Error('Expected marked staged commit or same-session companion');
      const root = input?.review.root ?? childRoot!;
      const id = 'sidebar-operation-' + (captures.length + 1);
      const template = nativeObservation('created', root, id).execute!.reviewExecution!.preparation;
      const preview: NativeReviewPreparedView = {
        root,
        valid: true,
        warnings: [],
        errors: [],
        filesCount: companionOf ? 0 : 1,
        additions: 2,
        deletions: 0,
        files: [],
        expiresAfterMs: 300000,
        reviewPreparation: {
          ...template,
          target: {
            ...template.target,
            branch: input?.review.targetBranch ?? parent!.preview.reviewPreparation.target.branch,
          },
        },
      };
      let finish!: () => void;
      const promise = track(
        new Promise((resolve) => {
          finish = () =>
            resolve(
              options.refusePrepare || (options.refuseChild && companionOf)
                ? {
                    ok: false,
                    error: {
                      code: 'NATIVE_REVIEW_UNAVAILABLE',
                      message: 'Original preparation refused',
                    },
                  }
                : { ok: true, result: { id, preview } },
            );
        }),
      );
      captures.push({ id, input, companionOf, root, preview, finish });
      if (!options.delayPrepare) finish();
      return promise;
    }),
    overrideMockIpcHandler(channels.EXECUTE, (raw) => command(raw, 'execute')),
    overrideMockIpcHandler(channels.RECONCILE, (raw) => command(raw, 'reconcile')),
    overrideMockIpcHandler(channels.RELEASE, (raw) => {
      record('release', raw);
      releases.push((raw as { id: string }).id);
      return { ok: true, result: { released: true } };
    }),
    overrideMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (raw) => {
      const query = raw as { method: string; params?: unknown };
      readRequests.push(query);
      record('read', raw);
      switch (query.method) {
        case 'git.status':
          return {
            ok: true,
            result: {
              branch: 'feature/details',
              ahead: 0,
              behind: 0,
              files: [{ path: 'src/editor.ts', status: 'M', staged: true }],
              hasUncommittedChanges: true,
            },
          };
        case 'file-tracking.getChanges':
          return { ok: true, result: { changes: [] } };
        case 'file-tracking.loadCommits':
          return { ok: true, result: { commits: [], boundarySha: 'base-A', nextToken: null } };
        case 'file-tracking.getAgentLocks':
          return { ok: true, result: { locks: [] } };
        case 'accept-changes.getStatus': {
          const reply = {
            ok: true,
            result: {
              hasRemote: !options.withoutOrigin,
              ...(options.withoutOrigin ? { remoteUrl: null } : {}),
              aheadOfTrunk: 0,
              behindTrunk: 0,
              hasConflicts: false,
              isContentMergedToTrunk: false,
            },
          };
          if (!options.delayStatus) return reply;
          let finish!: () => void;
          const promise = track(
            new Promise((resolve) => {
              finish = () => resolve(reply);
            }),
          );
          statusReplies.push({ finish });
          return promise;
        }
        case 'pr.refresh':
          return { ok: true, result: { pullRequests: [] } };
        case 'git.prStatus':
          return { ok: true, result: null };
        default:
          throw new Error('Unexpected controlled read/write: ' + query.method);
      }
    }),
  ];
  const stopReads = store.runSaga(lifecycleReadSaga);
  const stopStatus = store.runSaga(acceptChangesStatusSaga);
  store.dispatch(refreshRequested(previewWorkspaceId, true));
  return {
    base,
    captures,
    requests,
    releases,
    transcript,
    readRequests,
    statusReplies,
    retire,
    result,
    finishContext() {
      if (!options.withoutOrigin)
        throw new Error('Only the explicit no-origin context is deferred');
      const context = summaryContext(options.context ?? 'self-managed');
      for (const root of context.roots) {
        root.remotes = root.remotes.map((remote) => ({ ...remote, name: 'forge' }));
        root.reviewSelection.saved = { mode: 'explicit-remote', remoteName: 'forge' };
        if (root.reviewSelection.outcome.state === 'resolved')
          root.reviewSelection.outcome = {
            ...root.reviewSelection.outcome,
            source: 'explicit-remote',
          };
      }
      base.reads.forEach((read) => read.finish(context));
    },
    grant(role: NonNullable<SelectionFixtureOptions['role']>) {
      base.grant(role);
      store.dispatch(
        setWorkspaceEntity({
          ...selectWorkspaceById.select(store.state, previewWorkspaceId)!,
          baseRef: options.baseRef,
        }),
      );
    },
    async dispose() {
      stopReads();
      stopStatus();
      // Settle only these controlled original futures; no commands or observations are dispatched.
      statusReplies.forEach((reply) => reply.finish());
      base.reads.forEach((read) => read.finish());
      captures.forEach((c) => c.finish());
      requests.forEach((r) => r.finish());
      await Promise.allSettled([...pending]);
      if (window.electronAPI === bridge) window.electronAPI = previous;
      base.dispose();
      await Promise.resolve();
      cleanups.reverse().forEach((stop) => stop());
    },
  };
}
