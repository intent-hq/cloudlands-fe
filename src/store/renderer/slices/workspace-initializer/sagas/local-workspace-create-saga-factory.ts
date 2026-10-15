import { call, put, takeLeading, type SagaGenerator } from 'typed-redux-saga';
import {
  takeLatestFromSelector,
  type SelectorChannelPayload,
  type SelectorChannelSelector,
} from '@themislib/themis/saga';
import type { WorkspaceDomainClient } from '../../workspace/utils/workspace-domain-client-types';
import type { RepoValidationResult } from '$lib/utils/workspace-validation-factory';
import { validateBranchName } from '$lib/utils/workspace-validation-factory';
import { resolveSetupScriptParam } from '../../../../../features/setup-scripts/utils/setup-script-parameter';
import { m } from '$shared/paraglide/messages.js';
import {
  localWorkspaceCreateRequested,
  setWorkspaceLocalCreation,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
} from '../workspace-initializer-slice';
import {
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
} from '../../workspace-create-progress/workspace-create-progress-slice';
import { setWorkspaceEntity, loadWorkspacesRequested } from '../../workspace/workspace-slice';
import type {
  WorkspaceInitializerState,
  WorkspaceLocalCreation,
} from '../workspace-initializer-types';

/** One local repository create operation; neither component nor transport owns retries. */
export function createLocalWorkspaceCreateSaga<State>(options: {
  selectState: SelectorChannelSelector<WorkspaceInitializerState, [], State>;
  selectAuthority: SelectorChannelSelector<string | null, [], State>;
  selectLease: SelectorChannelSelector<string | null, [], State>;
  validateRepoPath: (path: string) => Promise<RepoValidationResult>;
  create: WorkspaceDomainClient['create'];
  persist: () => SagaGenerator<boolean>;
  newId: () => string;
}) {
  function* createLocal(
    action: ReturnType<typeof localWorkspaceCreateRequested>,
  ): SagaGenerator<void> {
    const [authority, retry] = action.payload;
    const lease = yield* options.selectLease.effect();
    const state = yield* options.selectState.effect();
    if (!lease || !state.hydrated || authority !== (yield* options.selectAuthority.effect()))
      return;
    const previous = state.localCreation?.authority === authority ? state.localCreation : null;
    if (previous?.status === 'pending' || (previous?.status === 'uncertain' && !retry)) return;
    if (retry && previous?.status !== 'uncertain') return;
    const form = state.compactFormState;
    const intent: WorkspaceLocalCreation =
      retry && previous
        ? { ...previous, status: 'pending', error: undefined }
        : {
            id: options.newId(),
            authority,
            repositoryPath: form?.repoPath?.trim() ?? '',
            baseRef: form?.branch?.trim() ?? '',
            status: 'pending',
          };
    yield* put(setWorkspaceLocalCreation(intent));
    // A recovery attempt inherits the previous request's possible dispatch.
    // Local preflight failure or cancellation cannot prove that it never created.
    let sent = previous?.status === 'uncertain';
    function* current(): SagaGenerator<boolean> {
      return (
        lease === (yield* options.selectLease.effect()) &&
        authority === (yield* options.selectAuthority.effect()) &&
        (yield* options.selectState.effect()).localCreation?.id === intent.id
      );
    }
    function* finish(value: WorkspaceLocalCreation): SagaGenerator<void> {
      if ((yield* options.selectState.effect()).localCreation?.id !== intent.id) return;
      yield* put(setWorkspaceLocalCreation(value));
      if (yield* current()) yield* call(options.persist);
    }
    try {
      const branch = validateBranchName(intent.baseRef);
      if (!branch.valid) throw new Error(branch.error);
      const repo = yield* call(options.validateRepoPath, intent.repositoryPath);
      if (!(yield* current())) return;
      // This bounded host accepts existing repository roots, not clone URLs or new repos.
      if (!repo.valid || !repo.directoryStatus?.isGitRepo)
        throw new Error(repo.error ?? m.workspace_repoSelector_notGitRepository_label());
      if (!(yield* call(options.persist)))
        throw new Error(m.workspace_localCreate_draftSave_error());
      if (!(yield* current())) return;
      yield* put(beginWorkspaceCreateProgress(intent.id));
      sent = true;
      const result = yield* call(options.create, {
        repositoryPath: intent.repositoryPath,
        baseRef: intent.baseRef,
        idempotencyKey: intent.id,
        progressId: intent.id,
        isNewRepo: false,
        // A visible bounded choice: isolated checkout without setup commands.
        setupScript: resolveSetupScriptParam({
          setupScript: '',
          setupScriptName: '',
          setupScriptNameSource: 'custom',
          explicitChoice: true,
          repoPath: intent.repositoryPath,
          repoConfigScript: null,
          repoConfigScriptRepo: null,
        }),
      });
      if (!(yield* current())) return;
      if (!result.ok) {
        yield* finish({
          ...intent,
          status: result.errorCode === 'base-ref-unresolvable' ? 'failure' : 'uncertain',
          error: result.error,
        });
        return;
      }
      yield* put(setWorkspaceEntity(result.data.workspace));
      yield* put(loadWorkspacesRequested());
      yield* put(setWorkspaceInitializerBranchForRepo(intent.repositoryPath, intent.baseRef));
      yield* put(setCompactWorkspaceInitializerFormState(null));
      yield* finish({ ...intent, status: 'success', workspaceId: result.data.workspace.id });
    } catch (error) {
      yield* finish({
        ...intent,
        status: sent ? 'uncertain' : 'failure',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      yield* put(clearWorkspaceCreateProgress(intent.id));
      const remaining = (yield* options.selectState.effect()).localCreation;
      if (remaining?.id === intent.id && remaining.status === 'pending') {
        // Closing or retiring cannot undo a daemon create. Retain its exact key.
        yield* finish({ ...intent, status: sent ? 'uncertain' : 'failure' });
      }
    }
  }
  function* ownCreation({ payload: lease }: SelectorChannelPayload<string | null>) {
    if (!lease) return;
    yield* takeLeading(localWorkspaceCreateRequested, createLocal);
  }
  return function* localWorkspaceCreateSaga() {
    yield* takeLatestFromSelector(options.selectLease, ownCreation);
  };
}
