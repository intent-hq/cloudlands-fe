import type { DraftAttachment } from '$lib/client/app-client';
import type { Readable } from 'svelte/store';
import { store as appStore } from '$store/renderer/store';
import {
  clearChatDraftRequested,
  flushChatDraftRequested,
  loadChatDraftRequested,
  saveChatDraftRequested,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import type {
  ChatDraftOperation,
  ChatDraftSnapshot,
} from '$store/renderer/slices/chat-state/chat-state-types';

type DraftOperations = {
  load: ChatDraftOperation<ChatDraftSnapshot>;
  write: ChatDraftOperation<{ ok: true; updatedAt: string }>;
};

function waitForOperation<T>(
  operations: Readable<DraftOperations>,
  key: keyof DraftOperations,
  requestId: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = operations.subscribe((value) => {
      const operation = value[key] as ChatDraftOperation<T>;
      if (operation.requestId !== requestId || operation.status === 'loading') return;
      unsubscribe();
      if (operation.status === 'success') resolve(operation.data as T);
      else reject(new Error(operation.error ?? 'Draft operation failed'));
    });
  });
}

/** Selector-backed draft transport for the component-local draft manager. */
export function createChatPanelDraftActions(operations: Readable<DraftOperations>) {
  let requestId = 0;
  return {
    get(workspaceId: string, agentId: string) {
      const id = ++requestId;
      appStore.dispatch(loadChatDraftRequested(workspaceId, agentId, id));
      return waitForOperation<ChatDraftSnapshot>(operations, 'load', id);
    },
    set(workspaceId: string, agentId: string, text: string, attachments?: DraftAttachment[]) {
      const id = ++requestId;
      appStore.dispatch(saveChatDraftRequested(workspaceId, agentId, text, attachments, id));
      return waitForOperation<{ ok: true; updatedAt: string }>(operations, 'write', id);
    },
    flush(workspaceId: string, agentId: string, text: string, attachments?: DraftAttachment[]) {
      const id = ++requestId;
      appStore.dispatch(flushChatDraftRequested(workspaceId, agentId, text, attachments, id));
      return waitForOperation<{ ok: true; updatedAt: string }>(operations, 'write', id);
    },
  };
}

export function clearChatPanelDraft(workspaceId: string, agentId: string): void {
  appStore.dispatch(clearChatDraftRequested(workspaceId, agentId));
}
