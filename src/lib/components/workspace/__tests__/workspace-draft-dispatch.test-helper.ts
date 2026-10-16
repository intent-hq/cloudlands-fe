import type { DraftAttachment } from '$lib/client/app-client';
import {
  NEW_WORKSPACE_DRAFT_AGENT_ID,
  NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
} from '$lib/components/workspace/initializer/new-workspace-draft';
import type {
  WorkspaceInitializerDraftPayload,
  WorkspaceInitializerDraftRestore,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

interface DraftAction {
  type: string;
  payload?: unknown;
}

interface DraftAdapterOptions {
  get?: (
    workspaceId: string,
    agentId: string,
  ) => Promise<{
    text?: string;
    attachments?: DraftAttachment[];
  } | null>;
  set?: (
    workspaceId: string,
    agentId: string,
    text: string,
    attachments?: DraftAttachment[],
  ) => Promise<unknown>;
  clear?: (workspaceId: string, agentId: string) => Promise<unknown>;
  setRestore?: (restore: WorkspaceInitializerDraftRestore | undefined) => void;
}

export function createWorkspaceDraftDispatchAdapter(options: DraftAdapterOptions) {
  let pending: WorkspaceInitializerDraftPayload | undefined;
  return (action: DraftAction): boolean => {
    const payload = Array.isArray(action.payload) ? action.payload : [];
    switch (action.type) {
      case 'workspaceInitializer/draftRestoreRequested': {
        const [, requestId] = payload as [string, string];
        options.setRestore?.({
          id: 'compact-workspace-initializer',
          requestId,
          status: 'pending',
          text: '',
          attachments: [],
        });
        void restore(requestId, options);
        return true;
      }
      case 'workspaceInitializer/draftSaveScheduled':
        pending = (payload as [string, WorkspaceInitializerDraftPayload])[1];
        return true;
      case 'workspaceInitializer/draftFlushRequested':
        if (pending && options.set) void persist(pending, options.set);
        pending = undefined;
        return true;
      case 'workspaceInitializer/draftSaveCancelled':
        pending = undefined;
        return true;
      case 'workspaceInitializer/draftClearRequested':
        pending = undefined;
        if (options.clear) {
          void options.clear(NEW_WORKSPACE_DRAFT_WORKSPACE_ID, NEW_WORKSPACE_DRAFT_AGENT_ID);
        }
        return true;
      case 'workspaceInitializer/draftOwnerReleased':
        pending = undefined;
        options.setRestore?.(undefined);
        return true;
      default:
        return false;
    }
  };
}

async function restore(requestId: string, options: DraftAdapterOptions) {
  try {
    const draft = await options.get?.(
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
    );
    options.setRestore?.({
      id: 'compact-workspace-initializer',
      requestId,
      status: draft ? 'restored' : 'empty',
      text: draft?.text ?? '',
      attachments: draft?.attachments ?? [],
    });
  } catch {
    options.setRestore?.({
      id: 'compact-workspace-initializer',
      requestId,
      status: 'error',
      text: '',
      attachments: [],
    });
  }
}

async function persist(
  payload: WorkspaceInitializerDraftPayload,
  set: NonNullable<DraftAdapterOptions['set']>,
) {
  await set(
    NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
    NEW_WORKSPACE_DRAFT_AGENT_ID,
    payload.text,
    payload.attachments,
  );
}
