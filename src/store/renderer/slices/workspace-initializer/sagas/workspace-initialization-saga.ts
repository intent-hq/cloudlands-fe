import {
  call,
  cancelled,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  redeemStagedAttachments,
  retainImagePlacementIdentity,
  sendHeldFirstMessage,
} from '$lib/components/workspace/initializer/staged-attachments';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import type { Workspace, WorkspaceId } from '$shared/types';
import { store as appStore } from '../../../store';
import { bootstrapNewWorkspaceLayout } from '../../panel-layout/panel-layout-slice';
import {
  selectPrincipalActionContext,
  selectWorkspaceCreationVisible,
} from '../../principal/principal-selectors';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { setInitialAgentId } from '../../workspace-agents/workspace-agents-slice';
import {
  goToStep,
  resetOnboarding,
  setOnboardingWorkspaceId,
} from '../../onboarding/onboarding-slice';
import { setHasCompletedProviderSetup } from '../../user-preferences/user-preferences-slice';
import {
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
} from '../../workspace-create-progress/workspace-create-progress-slice';
import { hydrateWorkspaceNavigation } from '../../workspace-navigation/workspace-navigation-slice';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { recordLastUsedSetupScript } from '$features/setup-scripts/last-used';
import { REPO_CONFIG_SCRIPT_NAME } from '$features/setup-scripts/repo-config';
import {
  selectWorkspaceInitializationOutcome,
  selectWorkspaceInitializationResume,
  selectWorkspaceInitializerRepoConfigProbe,
} from '../workspace-initializer-selectors';
import {
  setWorkspaceInitializerAgentForRepo,
  setWorkspaceInitializerBranchForRepo,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  workspaceInitializationFinished,
  workspaceInitializationPrepared,
  workspaceInitializationRequested,
  workspaceInitializationResumeRequested,
  workspaceInitializationResumeStored,
  clearWorkspaceInitializationResume,
  clearWorkspaceInitializationOutcome,
  workspaceInitializationSubmitted,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftSaveCancelled,
  workspaceInitializerRepoConfigProbeFinished,
  workspaceInitializerRepoConfigProbeReleased,
} from '../workspace-initializer-slice';
import type {
  WorkspaceInitializationConsumer,
  WorkspaceInitializationOutcome,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
  WorkspaceInitializationSubmission,
  WorkspaceInitializationStagedItem,
} from '../workspace-initializer-types';
import {
  buildWorkspaceInitializationResume,
  buildWorkspaceInitializationRetry,
  prepareCompactWorkspaceInitialization,
  prepareOnboardingWorkspaceInitialization,
  type PreparedWorkspaceInitialization,
} from './workspace-initialization-submission';

const logger = createLogger('WorkspaceInitializationSaga');

interface InitializationRun {
  seq: number;
  consumer: WorkspaceInitializationConsumer;
  progressId: string;
  request: WorkspaceInitializationRequest;
  success: (result: WorkspaceInitializationResult) => { type: string };
  failure: (error: Error) => { type: string };
}

function isCurrentAttempt(
  seq: number,
  consumer: WorkspaceInitializationConsumer,
  admission: string,
  dispatch: typeof appStore.dispatch,
): boolean {
  const outcome = selectWorkspaceInitializationOutcome.select(
    appStore.state,
    consumer.id,
    consumer.resourceId,
  );
  return (
    outcome?.seq === seq &&
    outcome.status === 'pending' &&
    appStore.dispatch === dispatch &&
    selectPrincipalActionContext.select(appStore.state) === admission &&
    selectWorkspaceCreationVisible.select(appStore.state)
  );
}

function current(action: InitializationRun, dispatch = appStore.dispatch): boolean {
  return isCurrentAttempt(action.seq, action.consumer, action.request.admission, dispatch);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Failed to create workspace');
}

function* finishAttempt(
  seq: number,
  consumer: WorkspaceInitializationConsumer,
  entrypoint: WorkspaceInitializationRequest['entrypoint'],
  outcome: Omit<WorkspaceInitializationOutcome, 'id' | 'resourceId' | 'seq' | 'entrypoint'>,
): SagaGenerator<void> {
  yield* put(workspaceInitializationFinished({ ...consumer, seq, entrypoint, ...outcome }));
}

function* finish(
  action: InitializationRun,
  outcome: Omit<WorkspaceInitializationOutcome, 'id' | 'resourceId' | 'seq' | 'entrypoint'>,
): SagaGenerator<void> {
  yield* finishAttempt(action.seq, action.consumer, action.request.entrypoint, outcome);
}

function* complete(
  request: WorkspaceInitializationRequest,
  workspaceId: string,
): SagaGenerator<void> {
  const record = request.setupScriptRecord;
  if (record) {
    yield* call(
      recordLastUsedSetupScript,
      record.repoPath,
      { name: record.name, content: record.content, nameSource: record.nameSource },
      record.githubUrl,
    );
  }
  const { lastSelectedRepo, compactFormState, onboarding, draft } = request.completion ?? {};
  if (lastSelectedRepo) yield* put(setWorkspaceInitializerLastSelectedRepo(lastSelectedRepo));
  if (compactFormState) yield* put(setCompactWorkspaceInitializerFormState(compactFormState));
  if (draft) {
    // Cancel the queued save before clearing so a close/unmount cannot re-save the prompt.
    yield* put(
      workspaceInitializerDraftSaveCancelled(
        draft.ownerId,
        draft.restoreRequestId,
        request.admission,
      ),
    );
    if (draft.clear) {
      yield* put(
        workspaceInitializerDraftClearRequested(
          draft.ownerId,
          crypto.randomUUID(),
          draft.restoreRequestId,
          request.admission,
        ),
      );
    }
  }
  if (onboarding) {
    yield* put(resetOnboarding(request.admission));
    yield* put(setHasCompletedProviderSetup(true));
    yield* put(setOnboardingWorkspaceId(workspaceId));
    yield* put(goToStep('ready'));
  }
}

function* storePrNumber(workspaceId: string, prNumber: number): SagaGenerator<void> {
  const result = yield* call(() =>
    workspaceClient.update({ id: workspaceId as WorkspaceId, prNumber }),
  );
  if (!result.ok) logger.warn('Failed to store PR number on workspace', { error: result.error });
}

function* registerRecent(
  repository: NonNullable<WorkspaceInitializationRequest['recentGitHubRepository']>,
): SagaGenerator<void> {
  try {
    yield* call(invoke, WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY, repository);
  } catch (error) {
    logger.warn('Failed to register picked repo as recent', { error });
  }
}

function* installWorkspace(
  action: InitializationRun,
  workspace: Workspace,
  dispatch: typeof appStore.dispatch,
  agentId?: string,
): SagaGenerator<void> {
  const { request } = action;
  try {
    const { getPanelLayoutManager } = yield* call(
      () => import('$features/layout/panel-layout-adapter'),
    );
    if (!current(action, dispatch)) return;
    getPanelLayoutManager(workspace.id).clearLayout();
  } catch (error) {
    logger.debug('Could not clear panel layout', { error });
  }
  try {
    const { workspaceStorageManager } = yield* call(
      () => import('../../workspace/utils/workspace-storage-manager'),
    );
    if (!current(action, dispatch)) return;
    workspaceStorageManager.clearState(workspace.id);
  } catch (error) {
    logger.debug('Could not clear workspace storage state', { error });
  }
  if (!current(action, dispatch)) return;
  yield* put(setWorkspaceEntity(workspace));
  if (agentId) yield* put(setInitialAgentId(workspace.id, agentId));
  yield* put(
    bootstrapNewWorkspaceLayout(
      workspace.id,
      agentId ?? null,
      request.agentTitle,
      request.coordinator,
      undefined,
      workspace.contextLinks ?? request.createRequest?.contextLinks ?? [],
    ),
  );
  yield* put(
    hydrateWorkspaceNavigation(workspace.id, {
      version: 2,
      workspace: { id: workspace.id },
      mainPanel: { type: 'empty' },
      drawer: { open: false, type: null, itemId: null },
      navigation: { history: [], currentIndex: -1 },
      ui: { hasInitialized: false },
    }),
  );
  yield* put(openWorkspaceTab(workspace.id));
}

function* deliverHeldMessage(
  action: InitializationRun,
  workspaceId: string,
  dispatch: typeof appStore.dispatch,
  agentId: string | undefined,
): SagaGenerator<
  Pick<WorkspaceInitializationOutcome, 'stage' | 'error' | 'stagedItems' | 'retryImageBlocks'>
> {
  const { request } = action;
  if (!request.heldMessage) return {};
  const isCurrent = () => current(action, dispatch);
  const items = request.stagedItems as ContextItem[];
  const redemption = yield* call(
    redeemStagedAttachments,
    workspaceId,
    items,
    undefined,
    undefined,
    isCurrent,
  );
  const stagedItems = redemption.items as WorkspaceInitializationStagedItem[];
  if (!current(action, dispatch)) return {};
  if (redemption.failedCount > 0) {
    return {
      stage: 'attachments',
      error: 'attachment-placement-failed',
      stagedItems,
    };
  }
  const sent = yield* call(
    sendHeldFirstMessage,
    {
      workspaceId,
      agentId,
      content: request.heldMessage.content,
      imageBlocks: request.heldMessage.imageBlocks,
      contextReferences: request.heldMessage.contextReferences,
    },
    redemption.fileBlocks,
    undefined,
    undefined,
    isCurrent,
  );
  if (!current(action, dispatch)) return {};
  if (!sent.sent) {
    return {
      stage: 'first-message',
      error: sent.errorDetail || 'first-message-send-failed',
      stagedItems: retainImagePlacementIdentity(
        redemption.items,
        sent.imageBlocks,
      ) as WorkspaceInitializationStagedItem[],
      retryImageBlocks: sent.imageBlocks,
    };
  }
  return { stagedItems };
}

function* initialize(action: InitializationRun): SagaGenerator<void> {
  const { request, progressId } = action;
  let settled = false;
  let stage: WorkspaceInitializationOutcome['stage'] = request.resume ? 'attachments' : 'create';
  let workspaceId = request.resume?.workspaceId;
  let agentId = request.resume?.agentId;
  let workspacePath = request.resume?.workspacePath;
  let pullCompleted = false;
  const dispatch = appStore.dispatch;
  if (!current(action, dispatch)) {
    const failure = new Error('initialization-cancelled');
    yield* finish(action, { status: 'cancelled', stage, error: failure.message });
    yield* put(action.failure(failure));
    return;
  }
  if (!request.resume) yield* put(beginWorkspaceCreateProgress(progressId));
  try {
    if (request.pull && !request.resume) {
      stage = 'pull';
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
      const pull = yield* call(
        [appClient.git, appClient.git.pull],
        request.pull.repositoryPath,
        request.pull.branch,
      );
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
      if (!pull.success) throw new Error(pull.error || 'pull-failed');
      pullCompleted = true;
    }
    if (!request.resume) {
      stage = 'create';
      if (!request.createRequest) throw new Error('missing-create-request');
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
      const result = yield* call([workspaceClient, workspaceClient.create], {
        ...request.createRequest,
        progressId,
      });
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
      if (!result.ok) {
        const failure = Object.assign(new Error(result.error), { errorCode: result.errorCode });
        throw failure;
      }
      const workspace = result.data.workspace;
      workspaceId = workspace.id;
      agentId = result.data.initialAgent?.id;
      workspacePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
      stage = 'post-create';
      yield* call(installWorkspace, action, workspace, dispatch, agentId);
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
    }
    if (!workspaceId) throw new Error('missing-workspace-id');
    stage = request.heldMessage ? 'attachments' : 'post-create';
    const delivery = yield* call(deliverHeldMessage, action, workspaceId, dispatch, agentId);
    if (!current(action, dispatch)) throw new Error('initialization-cancelled');
    if (delivery.stage) {
      yield* put(
        workspaceInitializationResumeStored(
          buildWorkspaceInitializationResume(action.consumer.id, request, {
            ...delivery,
            workspaceId,
            agentId,
            workspacePath,
          }),
        ),
      );
      yield* finish(action, {
        status: 'failure',
        ...delivery,
        workspaceId,
        agentId,
        workspacePath,
        ...(pullCompleted ? { pullCompleted: true } : {}),
        resumable: true,
      });
      yield* put(action.failure(new Error(delivery.error)));
      settled = true;
      return;
    }
    stage = 'post-create';
    yield* put(setWorkspaceInitializerLastSubmittedAgent(request.lastSubmittedAgent));
    if (request.rememberAgentRepoKey) {
      yield* put(
        setWorkspaceInitializerAgentForRepo(
          request.rememberAgentRepoKey,
          request.lastSubmittedAgent,
        ),
      );
    }
    if (request.rememberBranch) {
      yield* put(
        setWorkspaceInitializerBranchForRepo(
          request.rememberBranch.repoPath,
          request.rememberBranch.branch,
        ),
      );
    }
    if (request.selectedPrNumber) yield* fork(storePrNumber, workspaceId, request.selectedPrNumber);
    if (request.recentGitHubRepository) yield* fork(registerRecent, request.recentGitHubRepository);
    yield* put(clearWorkspaceInitializationResume(action.consumer.id));
    yield* call(complete, request, workspaceId);
    yield* finish(action, {
      status: 'success',
      workspaceId,
      agentId,
      workspacePath,
      ...(pullCompleted ? { pullCompleted: true } : {}),
      stagedItems: delivery.stagedItems,
    });
    yield* put(action.success({ workspaceId, agentId, workspacePath }));
    settled = true;
  } catch (error) {
    const cancelledAttempt =
      !current(action, dispatch) || errorMessage(error) === 'initialization-cancelled';
    const errorCode = (error as { errorCode?: string })?.errorCode;
    const resumable =
      !cancelledAttempt && !!workspaceId && (stage === 'post-create' || stage === 'attachments');
    if (resumable && workspaceId) {
      yield* put(
        workspaceInitializationResumeStored(
          buildWorkspaceInitializationResume(action.consumer.id, request, {
            workspaceId,
            agentId,
            workspacePath,
          }),
        ),
      );
    } else if (!cancelledAttempt && stage === 'create') {
      yield* put(clearWorkspaceInitializationResume(action.consumer.id));
    }
    yield* finish(action, {
      status: cancelledAttempt ? 'cancelled' : 'failure',
      stage,
      workspaceId,
      agentId,
      workspacePath,
      ...(pullCompleted ? { pullCompleted: true } : {}),
      error: errorMessage(error),
      ...(errorCode ? { errorCode } : {}),
      ...(resumable ? { resumable: true } : {}),
    });
    yield* put(action.failure(error instanceof Error ? error : new Error(errorMessage(error))));
    settled = true;
  } finally {
    if (!request.resume) yield* put(clearWorkspaceCreateProgress(progressId));
    if (!settled && (yield* cancelled())) {
      const failure = new Error('initialization-cancelled');
      yield* finish(action, { status: 'cancelled', stage, error: failure.message });
      yield* put(action.failure(failure));
    }
  }
}

type RequestedAction = ReturnType<typeof workspaceInitializationRequested>;
type SubmittedAction = ReturnType<typeof workspaceInitializationSubmitted>;
type ResumeAction = ReturnType<typeof workspaceInitializationResumeRequested>;
type ObservedAction = { type: string; payload?: unknown };

function isRepoConfigProbeSettlement(
  candidate: ObservedAction,
  id: string,
  requestId: string,
): boolean {
  return (
    (candidate.type === workspaceInitializerRepoConfigProbeFinished.type ||
      candidate.type === workspaceInitializerRepoConfigProbeReleased.type) &&
    Array.isArray(candidate.payload) &&
    candidate.payload[0] === id &&
    candidate.payload[1] === requestId
  );
}

function* waitForSubmissionRelease(action: SubmittedAction): SagaGenerator<true> {
  while (true) {
    const released = yield* take(clearWorkspaceInitializationOutcome);
    const [id, seq] = released.payload;
    if (id === action.payload.consumer.id && (seq === undefined || seq === action.seq)) return true;
  }
}

function* settleSubmissionProbe(
  submission: WorkspaceInitializationSubmission,
  action: SubmittedAction,
): SagaGenerator<WorkspaceInitializationSubmission> {
  const reference = submission.repoConfigProbe;
  if (!reference) return submission;
  let probe = yield* selectWorkspaceInitializerRepoConfigProbe.effect(reference.id);
  if (probe?.requestId === reference.requestId && probe.status === 'pending') {
    const settled = yield* race({
      changed: take((candidate: ObservedAction) =>
        isRepoConfigProbeSettlement(candidate, reference.id, reference.requestId),
      ),
      timeout: delay(2000),
      released: call(waitForSubmissionRelease, action),
    });
    if (settled.released) throw new Error('initialization-cancelled');
    probe = yield* selectWorkspaceInitializerRepoConfigProbe.effect(reference.id);
  }
  if (!probe || probe.requestId !== reference.requestId || probe.status === 'pending') {
    return submission.entrypoint === 'compact'
      ? { ...submission, repoConfigUnavailable: true }
      : submission;
  }
  if (probe.status === 'failed') {
    return submission.entrypoint === 'compact'
      ? { ...submission, repoConfigUnavailable: false, repoConfigError: true }
      : submission;
  }
  const canApply =
    probe.applyAllowed &&
    !submission.setupScriptExplicit &&
    submission.setupScript === probe.setupScriptAtRequest;
  return {
    ...submission,
    repoConfigUnavailable: false,
    repoConfigScript: probe.script,
    repoConfigScriptRepo: submission.entrypoint === 'compact' ? probe.probeKey : probe.repoKey,
    ...(canApply && probe.script
      ? {
          setupScript: probe.script,
          setupScriptName: REPO_CONFIG_SCRIPT_NAME,
          setupScriptNameSource: 'repo-config' as const,
        }
      : {}),
  };
}

function* requestInitialization(action: RequestedAction): SagaGenerator<void> {
  const { request, consumer, progressId } = action.payload;
  yield* call(initialize, {
    seq: action.seq,
    consumer,
    progressId,
    request,
    success: (result: WorkspaceInitializationResult) => action.success(result),
    failure: (error: Error) => action.failure(error),
  });
}

function* submit(action: SubmittedAction): SagaGenerator<void> {
  const { submission, consumer, progressId } = action.payload;
  const dispatch = appStore.dispatch;
  const isCurrent = () => isCurrentAttempt(action.seq, consumer, submission.admission, dispatch);
  let prepared: PreparedWorkspaceInitialization | null = null;
  let preparationSettled = false;
  try {
    if (!isCurrent()) throw new Error('initialization-cancelled');
    const preparedSubmission = yield* call(settleSubmissionProbe, submission, action);
    if (!isCurrent()) throw new Error('initialization-cancelled');
    prepared =
      preparedSubmission.entrypoint === 'compact'
        ? yield* call(prepareCompactWorkspaceInitialization, preparedSubmission, isCurrent)
        : yield* call(prepareOnboardingWorkspaceInitialization, preparedSubmission, isCurrent);
    if (!prepared || !isCurrent()) throw new Error('initialization-cancelled');
    yield* put(workspaceInitializationPrepared(consumer.id, action.seq, prepared.prepared));
    preparationSettled = true;
  } catch (error) {
    const cancelledAttempt = !isCurrent() || errorMessage(error) === 'initialization-cancelled';
    if (!cancelledAttempt)
      logger.error('Workspace initialization preparation failed', error as Error);
    yield* finishAttempt(action.seq, consumer, submission.entrypoint, {
      status: cancelledAttempt ? 'cancelled' : 'failure',
      stage: 'prepare',
      error: errorMessage(error),
    });
    yield* put(action.failure(error instanceof Error ? error : new Error(errorMessage(error))));
    preparationSettled = true;
    return;
  } finally {
    if (!preparationSettled && (yield* cancelled())) {
      const failure = new Error('initialization-cancelled');
      yield* finishAttempt(action.seq, consumer, submission.entrypoint, {
        status: 'cancelled',
        stage: 'prepare',
        error: failure.message,
      });
      yield* put(action.failure(failure));
    }
  }
  yield* call(initialize, {
    seq: action.seq,
    consumer,
    progressId,
    request: prepared.request,
    success: (result: WorkspaceInitializationResult) => action.success(result),
    failure: (error: Error) => action.failure(error),
  });
}

function* resume(action: ResumeAction): SagaGenerator<void> {
  const { input, consumer, progressId } = action.payload;
  const stored = selectWorkspaceInitializationResume.select(appStore.state, consumer.id);
  if (
    !stored ||
    stored.request.admission !== input.admission ||
    stored.request.entrypoint !== input.entrypoint
  ) {
    const failure = new Error(
      stored ? 'initialization-cancelled' : 'missing-initialization-resume',
    );
    yield* finishAttempt(action.seq, consumer, input.entrypoint, {
      status: stored ? 'cancelled' : 'failure',
      stage: 'attachments',
      error: failure.message,
    });
    yield* put(action.failure(failure));
    return;
  }
  yield* call(initialize, {
    seq: action.seq,
    consumer,
    progressId,
    request: buildWorkspaceInitializationRetry(stored, input),
    success: (result: WorkspaceInitializationResult) => action.success(result),
    failure: (error: Error) => action.failure(error),
  });
}

export function* workspaceInitializationSaga(): SagaGenerator<void> {
  yield* takeEvery(workspaceInitializationRequested, requestInitialization);
  yield* takeEvery(workspaceInitializationSubmitted, submit);
  yield* takeEvery(workspaceInitializationResumeRequested, resume);
}
