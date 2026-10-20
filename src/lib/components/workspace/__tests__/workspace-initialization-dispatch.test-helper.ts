import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  redeemStagedAttachments,
  retainImagePlacementIdentity,
  sendHeldFirstMessage,
} from '$lib/components/workspace/initializer/staged-attachments';
import type {
  WorkspaceInitializationOutcome,
  WorkspaceInitializationRequest,
  WorkspaceInitializationResult,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

interface InitializationAction {
  asyncActionType?: string;
  seq: number;
  payload: {
    request: WorkspaceInitializationRequest;
    consumer: { id: string; resourceId: string };
    progressId: string;
  };
  success: (result: WorkspaceInitializationResult) => unknown;
  failure: (error: Error) => unknown;
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
}

export function createWorkspaceInitializationDispatchAdapter(options: AdapterOptions) {
  return (action: InitializationAction) => {
    if (action.asyncActionType !== 'workspaceInitializer/initializationRequested') return action;
    void settleInitialization(action, options);
    return action;
  };
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
        };
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
        };
        publish(failure);
        throw new Error(sent.errorDetail || 'first-message-send-failed');
      }
    }

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
