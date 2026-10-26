import type { ContextItem } from '$lib/components/chat/input/context-api';
import { runSaga } from 'redux-saga';
import {
  redeemStagedAttachments,
  retainImagePlacementIdentity,
  sendHeldFirstMessage,
} from '$lib/components/workspace/initializer/staged-attachments';
import { store as appStore } from '$store/renderer/store';
import {
  buildWorkspaceInitializationResume,
  buildWorkspaceInitializationRetry,
  prepareCompactWorkspaceInitialization,
  prepareOnboardingWorkspaceInitialization,
} from '$store/renderer/slices/workspace-initializer/sagas/workspace-initialization-submission';
import {
  fetchGitHubRepoConfigSetupScript,
  fetchRepoConfigSetupScript,
  REPO_CONFIG_SCRIPT_NAME,
} from '$features/setup-scripts/repo-config';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';
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
  WorkspaceInitializerRepoConfigProbeInput,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

interface TestRepoConfigProbe extends WorkspaceInitializerRepoConfigProbeInput {
  id: string;
  requestId: string;
  admission: string;
  status: 'pending' | 'ready' | 'failed';
  script: string | null;
}

const repoConfigProbes = new Map<string, TestRepoConfigProbe>();
const repoConfigProbeSubscribers = new Map<string, Set<(probe?: TestRepoConfigProbe) => void>>();

function publishRepoConfigProbe(id: string, probe?: TestRepoConfigProbe) {
  if (probe) repoConfigProbes.set(id, probe);
  else repoConfigProbes.delete(id);
  for (const subscriber of repoConfigProbeSubscribers.get(id) ?? []) subscriber(probe);
}

export function selectTestWorkspaceInitializerRepoConfigProbe(id: string) {
  return {
    subscribe(run: (probe?: TestRepoConfigProbe) => void) {
      const subscribers = repoConfigProbeSubscribers.get(id) ?? new Set();
      subscribers.add(run);
      repoConfigProbeSubscribers.set(id, subscribers);
      run(repoConfigProbes.get(id));
      return () => {
        subscribers.delete(run);
        if (subscribers.size === 0) repoConfigProbeSubscribers.delete(id);
      };
    },
  };
}

interface AsyncInitializationAction {
  type?: string;
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

interface RepoConfigProbeRequestedAction {
  type: 'workspaceInitializer/repoConfigProbeRequested';
  asyncActionType?: string;
  payload: [
    id: string,
    requestId: string,
    admission: string,
    input: WorkspaceInitializerRepoConfigProbeInput,
  ];
}

interface RepoConfigProbeReleasedAction {
  type: 'workspaceInitializer/repoConfigProbeReleased';
  asyncActionType?: string;
  payload: [id: string, requestId?: string];
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
  return (
    action:
      | InitializationAction
      | SubmissionAction
      | ResumeAction
      | RepoConfigProbeRequestedAction
      | RepoConfigProbeReleasedAction,
  ) => {
    if (action.asyncActionType === 'workspaceInitializer/initializationSubmitted') {
      void settleSubmittedInitialization(action as SubmissionAction, options);
    } else if (action.asyncActionType === 'workspaceInitializer/initializationResumeRequested') {
      void settleResumedInitialization(action as ResumeAction, options);
    } else if (action.asyncActionType === 'workspaceInitializer/initializationRequested') {
      void settleInitialization(action as InitializationAction, options);
    } else if (action.type === 'workspaceInitializer/repoConfigProbeRequested') {
      void settleRepoConfigProbe(action as RepoConfigProbeRequestedAction);
    } else if (action.type === 'workspaceInitializer/repoConfigProbeReleased') {
      const [id, requestId] = (action as RepoConfigProbeReleasedAction).payload;
      const current = repoConfigProbes.get(id);
      if (current && (requestId === undefined || current.requestId === requestId)) {
        publishRepoConfigProbe(id);
      }
    }
    return action;
  };
}

async function settleRepoConfigProbe(action: RepoConfigProbeRequestedAction) {
  const [id, requestId, admission, input] = action.payload;
  const pending = { ...input, id, requestId, admission, status: 'pending' as const, script: null };
  publishRepoConfigProbe(id, pending);
  if (input.debounce) await new Promise((resolve) => setTimeout(resolve, 300));
  if (repoConfigProbes.get(id)?.requestId !== requestId) return;
  try {
    let script: string | null = null;
    if (input.identity.type === 'local' && input.identity.path?.startsWith('/')) {
      script = await fetchRepoConfigSetupScript(input.identity.path);
    } else if (input.identity.type === 'github' && input.identity.path) {
      const github = parseGitHubUrl(input.identity.githubUrl || input.identity.path);
      if (github) {
        script = await fetchGitHubRepoConfigSetupScript(
          github.owner,
          github.repo,
          input.identity.branch || undefined,
        );
      }
    }
    if (repoConfigProbes.get(id)?.requestId === requestId) {
      publishRepoConfigProbe(id, { ...pending, status: 'ready', script });
    }
  } catch {
    if (repoConfigProbes.get(id)?.requestId === requestId) {
      publishRepoConfigProbe(id, { ...pending, status: 'failed', script: null });
    }
  }
}

async function settleSubmissionProbeForTest(
  submission: WorkspaceInitializationSubmission,
): Promise<WorkspaceInitializationSubmission> {
  const reference = submission.repoConfigProbe;
  if (!reference) return submission;
  let probe = repoConfigProbes.get(reference.id);
  if (probe?.requestId === reference.requestId && probe.status === 'pending') {
    probe = await new Promise<TestRepoConfigProbe | undefined>((resolve) => {
      const unsubscribe = selectTestWorkspaceInitializerRepoConfigProbe(reference.id).subscribe(
        (next) => {
          if (!next || next.requestId !== reference.requestId || next.status !== 'pending') {
            unsubscribe();
            resolve(next);
          }
        },
      );
    });
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
  const { submission: submitted, consumer, progressId } = action.payload;
  try {
    const submission = await settleSubmissionProbeForTest(submitted);
    const prepare =
      submission.entrypoint === 'compact'
        ? prepareCompactWorkspaceInitialization
        : prepareOnboardingWorkspaceInitialization;
    const prepared = await runSaga(
      { onError: () => {} },
      prepare,
      submission as never,
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
      entrypoint: submitted.entrypoint,
      status: 'failure',
      stage: 'prepare',
      error: failure.message,
    });
    action.failure(failure);
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
