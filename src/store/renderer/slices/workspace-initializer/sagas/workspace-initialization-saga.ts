import { call, cancelled, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

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
  beginWorkspaceCreateProgress,
  clearWorkspaceCreateProgress,
} from '../../workspace-create-progress/workspace-create-progress-slice';
import { hydrateWorkspaceNavigation } from '../../workspace-navigation/workspace-navigation-slice';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectWorkspaceInitializationOutcome } from '../workspace-initializer-selectors';
import {
  setWorkspaceInitializerLastSubmittedAgent,
  workspaceInitializationFinished,
  workspaceInitializationRequested,
} from '../workspace-initializer-slice';
import type {
  WorkspaceInitializationOutcome,
  WorkspaceInitializationStagedItem,
} from '../workspace-initializer-types';

const logger = createLogger('WorkspaceInitializationSaga');
type RequestAction = ReturnType<typeof workspaceInitializationRequested>;

function current(action: RequestAction, dispatch = appStore.dispatch): boolean {
  const { consumer, request } = action.payload;
  const outcome = selectWorkspaceInitializationOutcome.select(
    appStore.state,
    consumer.id,
    consumer.resourceId,
  );
  return (
    outcome?.seq === action.seq &&
    outcome.status === 'pending' &&
    appStore.dispatch === dispatch &&
    selectPrincipalActionContext.select(appStore.state) === request.admission &&
    selectWorkspaceCreationVisible.select(appStore.state)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Failed to create workspace');
}

function* finish(
  action: RequestAction,
  outcome: Omit<WorkspaceInitializationOutcome, 'id' | 'resourceId' | 'seq' | 'entrypoint'>,
): SagaGenerator<void> {
  const { consumer, request } = action.payload;
  yield* put(
    workspaceInitializationFinished({
      ...consumer,
      seq: action.seq,
      entrypoint: request.entrypoint,
      ...outcome,
    }),
  );
}

function* storePrNumber(workspaceId: string, prNumber: number): SagaGenerator<void> {
  const result = yield* call(() =>
    workspaceClient.update({ id: workspaceId as WorkspaceId, prNumber }),
  );
  if (!result.ok) logger.warn('Failed to store PR number on workspace', { error: result.error });
}

function* registerRecent(
  repository: NonNullable<RequestAction['payload']['request']['recentGitHubRepository']>,
): SagaGenerator<void> {
  try {
    yield* call(invoke, WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY, repository);
  } catch (error) {
    logger.warn('Failed to register picked repo as recent', { error });
  }
}

function* installWorkspace(
  action: RequestAction,
  workspace: Workspace,
  dispatch: typeof appStore.dispatch,
  agentId?: string,
): SagaGenerator<void> {
  const { request } = action.payload;
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
  action: RequestAction,
  workspaceId: string,
  dispatch: typeof appStore.dispatch,
  agentId: string | undefined,
): SagaGenerator<
  Pick<WorkspaceInitializationOutcome, 'stage' | 'error' | 'stagedItems' | 'retryImageBlocks'>
> {
  const { request } = action.payload;
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

function* initialize(action: RequestAction): SagaGenerator<void> {
  const { request, progressId } = action.payload;
  let settled = false;
  let stage: WorkspaceInitializationOutcome['stage'] = request.resume ? 'attachments' : 'create';
  let workspaceId = request.resume?.workspaceId;
  let agentId = request.resume?.agentId;
  let workspacePath: string | undefined;
  const dispatch = appStore.dispatch;
  if (!request.resume) yield* put(beginWorkspaceCreateProgress(progressId));
  try {
    if (request.pull && !request.resume) {
      stage = 'pull';
      const pull = yield* call(
        [appClient.git, appClient.git.pull],
        request.pull.repositoryPath,
        request.pull.branch,
      );
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
      if (!pull.success) throw new Error(pull.error || 'pull-failed');
    }
    if (!request.resume) {
      stage = 'create';
      if (!request.createRequest) throw new Error('missing-create-request');
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
      yield* call(installWorkspace, action, workspace, dispatch, agentId);
      if (!current(action, dispatch)) throw new Error('initialization-cancelled');
    }
    if (!workspaceId) throw new Error('missing-workspace-id');
    const delivery = yield* call(deliverHeldMessage, action, workspaceId, dispatch, agentId);
    if (!current(action, dispatch)) throw new Error('initialization-cancelled');
    if (delivery.stage) {
      yield* finish(action, {
        status: 'failure',
        ...delivery,
        workspaceId,
        agentId,
        workspacePath,
      });
      yield* put(action.failure(new Error(delivery.error)));
      settled = true;
      return;
    }
    yield* put(setWorkspaceInitializerLastSubmittedAgent(request.lastSubmittedAgent));
    if (request.selectedPrNumber) yield* fork(storePrNumber, workspaceId, request.selectedPrNumber);
    if (request.recentGitHubRepository) yield* fork(registerRecent, request.recentGitHubRepository);
    yield* finish(action, {
      status: 'success',
      workspaceId,
      agentId,
      workspacePath,
      stagedItems: delivery.stagedItems,
    });
    yield* put(action.success({ workspaceId, agentId, workspacePath }));
    settled = true;
  } catch (error) {
    const cancelledAttempt =
      !current(action, dispatch) || errorMessage(error) === 'initialization-cancelled';
    const errorCode = (error as { errorCode?: string })?.errorCode;
    yield* finish(action, {
      status: cancelledAttempt ? 'cancelled' : 'failure',
      stage,
      workspaceId,
      agentId,
      workspacePath,
      error: errorMessage(error),
      ...(errorCode ? { errorCode } : {}),
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

export function* workspaceInitializationSaga(): SagaGenerator<void> {
  yield* takeEvery(workspaceInitializationRequested, initialize);
}
