import type { ContextItem } from '$lib/components/chat/input/context-api';
import { runSaga } from 'redux-saga';
import {
  redeemStagedAttachments,
  retainImagePlacementIdentity,
  sendHeldFirstMessage,
} from '$lib/components/workspace/initializer/staged-attachments';
import {
  releaseWorkspaceInitializationPreparation,
  resolveWorkspaceInitializationPreparation,
} from '$lib/components/workspace/initializer/workspace-initialization-preparation';
import { store as appStore } from '$store/renderer/store';
import {
  buildWorkspaceInitializationResume,
  buildWorkspaceInitializationRetry,
  prepareCompactWorkspaceInitialization,
  prepareOnboardingWorkspaceInitialization,
} from '$store/renderer/slices/workspace-initializer/sagas/workspace-initialization-submission';
import {
  clearWorkspaceInitializationResume,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerAgentForRepo,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftSaveCancelled,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import type {
  WorkspaceInitializationOutcome,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResume,
  WorkspaceInitializationResumeInput,
  WorkspaceInitializationResult,
  WorkspaceInitializationSubmission,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

interface AsyncInitializationAction {
  asyncActionType?: string;
  seq: number;
  success: (result: WorkspaceInitializationResult) => unknown;
  failure: (error: Error) => unknown;
}

interface InitializationAction extends AsyncInitializationAction {
  payload: {
    request: WorkspaceInitializationRequest;
    consumer: { id: string; resourceId: string };
    progressId: string;
  };
}

interface SubmissionAction extends AsyncInitializationAction {
  payload: {
    submission: WorkspaceInitializationSubmission;
    consumer: { id: string; resourceId: string };
    progressId: string;
  };
}

interface ResumeAction extends AsyncInitializationAction {
  payload: {
    input: WorkspaceInitializationResumeInput;
    consumer: { id: string; resourceId: string };
    progressId: string;
  };
}

interface CreateSuccess {
  ok: true;
  data: {
    workspace: {
      id: string;
      path?: string;
      repositoryPath?: string;
      worktreePath?: string;
    };
    initialAgent?: { id: string };
  };
}

interface CreateFailure {
  ok: false;
  error: string;
  errorCode?: string;
}

interface AdapterOptions {
  create: (request: Record<string, unknown>) => Promise<CreateSuccess | CreateFailure>;
  pull?: (repositoryPath: string, branch: string) => Promise<{ success: boolean; error?: string }>;
  setOutcome?: (outcome: Partial<WorkspaceInitializationOutcome> | undefined) => void;
  getResume?: (id: string) => WorkspaceInitializationResume | undefined;
  setResume?: (resume: WorkspaceInitializationResume | undefined) => void;
}

export function createWorkspaceInitializationDispatchAdapter(options: AdapterOptions) {
  return (action: InitializationAction | SubmissionAction | ResumeAction) => {
    if (action.asyncActionType === 'workspaceInitializer/initializationSubmitted') {
      void settleSubmittedInitialization(action as SubmissionAction, options);
    } else if (action.asyncActionType === 'workspaceInitializer/initializationResumeRequested') {
      void settleResumedInitialization(action as ResumeAction, options);
    } else if (action.asyncActionType === 'workspaceInitializer/initializationRequested') {
      void settleInitialization(action as InitializationAction, options);
    }
    return action;
  };
}

async function settleResumedInitialization(action: ResumeAction, options: AdapterOptions) {
  const { input, consumer, progressId } = action.payload;
  const resume = options.getResume?.(consumer.id);
  if (!resume) {
    action.failure(new Error('missing-initialization-resume'));
    return;
  }
  await settleInitialization(
    {
      ...action,
      payload: {
        request: buildWorkspaceInitializationRetry(resume, input),
        consumer,
        progressId,
      },
    },
    options,
  );
}

async function settleSubmittedInitialization(action: SubmissionAction, options: AdapterOptions) {
  const { submission, consumer, progressId } = action.payload;
  try {
    const preparation = submission.preparationId
      ? await resolveWorkspaceInitializationPreparation(submission.preparationId)
      : undefined;
    if (submission.preparationId && !preparation) throw new Error('initialization-cancelled');
    const preparedSubmission = preparation ? { ...submission, ...preparation } : submission;
    const prepare =
      submission.entrypoint === 'compact'
        ? prepareCompactWorkspaceInitialization
        : prepareOnboardingWorkspaceInitialization;
    const prepared = await runSaga(
      { onError: () => {} },
      prepare,
      preparedSubmission as never,
      () => true,
    ).toPromise();
    if (!prepared) throw new Error('initialization-cancelled');
    await settleInitialization(
      {
        ...action,
        payload: { request: prepared.request, consumer, progressId },
      },
      options,
    );
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    options.setOutcome?.({
      ...consumer,
      seq: action.seq,
      entrypoint: submission.entrypoint,
      status: 'failure',
      stage: 'prepare',
      error: failure.message,
    });
    action.failure(failure);
  } finally {
    if (submission.preparationId)
      releaseWorkspaceInitializationPreparation(submission.preparationId);
  }
}

function completeInitialization(request: WorkspaceInitializationRequest, consumerId: string) {
  appStore.dispatch(setWorkspaceInitializerLastSubmittedAgent(request.lastSubmittedAgent));
  if (request.rememberAgentRepoKey) {
    appStore.dispatch(
      setWorkspaceInitializerAgentForRepo(request.rememberAgentRepoKey, request.lastSubmittedAgent),
    );
  }
  if (request.rememberBranch) {
    appStore.dispatch(
      setWorkspaceInitializerBranchForRepo(
        request.rememberBranch.repoPath,
        request.rememberBranch.branch,
      ),
    );
  }
  appStore.dispatch(clearWorkspaceInitializationResume(consumerId));
  const { lastSelectedRepo, compactFormState, draft } = request.completion ?? {};
  if (lastSelectedRepo)
    appStore.dispatch(setWorkspaceInitializerLastSelectedRepo(lastSelectedRepo));
  if (compactFormState)
    appStore.dispatch(setCompactWorkspaceInitializerFormState(compactFormState));
  if (!draft) return;
  appStore.dispatch(
    workspaceInitializerDraftSaveCancelled(
      draft.ownerId,
      draft.restoreRequestId,
      request.admission,
    ),
  );
  if (draft.clear) {
    appStore.dispatch(
      workspaceInitializerDraftClearRequested(
        draft.ownerId,
        crypto.randomUUID(),
        draft.restoreRequestId,
        request.admission,
      ),
    );
  }
}

async function settleInitialization(action: InitializationAction, options: AdapterOptions) {
  const { request, consumer, progressId } = action.payload;
  const publish = (outcome: Partial<WorkspaceInitializationOutcome>) =>
    options.setOutcome?.({
      ...consumer,
      seq: action.seq,
      entrypoint: request.entrypoint,
      ...outcome,
    });
  publish({ status: 'pending' });
  let failure: Partial<WorkspaceInitializationOutcome> | undefined;
  let stage: WorkspaceInitializationOutcome['stage'] = request.resume ? 'attachments' : 'create';
  let workspaceId = request.resume?.workspaceId;
  let agentId = request.resume?.agentId;
  let workspacePath = request.resume?.workspacePath;
  let pullCompleted = false;
  let stagedItems = request.stagedItems;
  try {
    if (request.pull && !request.resume) {
      stage = 'pull';
      const result = await options.pull?.(request.pull.repositoryPath, request.pull.branch);
      if (result && !result.success) {
        failure = { status: 'failure', stage: 'pull', error: result.error };
        publish(failure);
        throw new Error(result.error || 'pull-failed');
      }
      pullCompleted = true;
    }

    if (!request.resume) {
      stage = 'create';
      const result = await options.create({ ...request.createRequest, progressId });
      if (!result.ok) throw new Error(result.error);
      const { workspace } = result.data;
      workspaceId = workspace.id;
      agentId = result.data.initialAgent?.id;
      workspacePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
    }
    if (!workspaceId) throw new Error('missing-workspace-id');

    if (request.heldMessage) {
      stage = 'attachments';
      const items = request.stagedItems as ContextItem[];
      const redemption = await redeemStagedAttachments(workspaceId, items);
      stagedItems = redemption.items;
      if (redemption.failedCount > 0) {
        failure = {
          status: 'failure',
          stage: 'attachments',
          workspaceId,
          agentId,
          workspacePath,
          ...(pullCompleted ? { pullCompleted: true } : {}),
          stagedItems: redemption.items,
          error: 'attachment-placement-failed',
          resumable: true,
        };
        options.setResume?.(
          buildWorkspaceInitializationResume(consumer.id, request, {
            workspaceId,
            agentId,
            workspacePath,
            stagedItems: failure.stagedItems,
          }),
        );
        publish(failure);
        throw new Error('attachment-placement-failed');
      }
      const sent = await sendHeldFirstMessage(
        {
          workspaceId,
          agentId,
          content: request.heldMessage.content,
          imageBlocks: request.heldMessage.imageBlocks,
          contextReferences: request.heldMessage.contextReferences,
        },
        redemption.fileBlocks,
      );
      if (!sent.sent) {
        stage = 'first-message';
        failure = {
          status: 'failure',
          stage: 'first-message',
          workspaceId,
          agentId,
          workspacePath,
          ...(pullCompleted ? { pullCompleted: true } : {}),
          stagedItems: retainImagePlacementIdentity(redemption.items, sent.imageBlocks),
          retryImageBlocks: sent.imageBlocks,
          error: sent.errorDetail || 'first-message-send-failed',
          resumable: true,
        };
        options.setResume?.(
          buildWorkspaceInitializationResume(consumer.id, request, {
            workspaceId,
            agentId,
            workspacePath,
            stagedItems: failure.stagedItems,
            retryImageBlocks: failure.retryImageBlocks,
          }),
        );
        publish(failure);
        throw new Error(sent.errorDetail || 'first-message-send-failed');
      }
    }

    options.setResume?.(undefined);
    completeInitialization(request, consumer.id);
    publish({
      status: 'success',
      workspaceId,
      agentId,
      workspacePath,
      ...(pullCompleted ? { pullCompleted: true } : {}),
      stagedItems,
    });
    action.success({ workspaceId, agentId, workspacePath });
  } catch (error) {
    if (!failure) {
      publish({
        status: 'failure',
        stage,
        workspaceId,
        agentId,
        workspacePath,
        ...(pullCompleted ? { pullCompleted: true } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    action.failure(error instanceof Error ? error : new Error(String(error)));
  }
}
