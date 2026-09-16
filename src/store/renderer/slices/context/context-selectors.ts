import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { emptyWorkspaceContextState } from './context-slice';
import type { ContextItem } from '$features/context/types';
import type { ContextAttachment, ContextWorkspaceState } from './context-types';
import { selectWorkspaceAgentIds } from '../workspace-agents/workspace-agents-selectors';
import {
  selectAgentMessages,
  selectAgentHistoryMessages,
} from '../agent-session/agent-session-selectors';
import { selectWorkspaceComposerContext } from '../transient-ui/transient-ui-selectors';
import { selectHydratedBlocks } from '../chat-state/chat-state-selectors';
import { hydratedBlockKey } from '../chat-state/chat-state-types';
import { isFileBlock } from '$shared/types/content-block.guards';

export const selectWorkspaceContextAttachments = store.createSelector(
  (state, workspaceId: string): ContextAttachment[] => {
    const attachments: ContextAttachment[] = [];
    const seen = new Set<string>();
    const seenInlineData = new Set<string>();
    const append = (attachment: ContextAttachment) => {
      // Distinct originals can share a slim thumbnail; dedupe inline bytes only when complete.
      const key = attachment.block.attachmentId ?? attachment.id;
      if (seen.has(key)) return;
      if (
        !attachment.block.attachmentId &&
        attachment.block.data &&
        !attachment.block.dataTruncated
      ) {
        const dataKey = `${attachment.block.mimeType}/${attachment.block.data}`;
        if (seenInlineData.has(dataKey)) return;
        seenInlineData.add(dataKey);
      }
      seen.add(key);
      attachments.push(attachment);
    };

    for (const [agentId, items] of Object.entries(
      selectWorkspaceComposerContext.select(state, workspaceId),
    )) {
      for (const item of getItems(items)) {
        if (item.imageData && item.imageMimeType) {
          append({
            id: `draft/${agentId}/${item.id}`,
            name: item.label,
            block: { type: 'image', data: item.imageData, mimeType: item.imageMimeType },
          });
        } else if (item.type === 'file' && (item.attachmentId || item.placementStatus)) {
          append({
            id: `draft/${agentId}/${item.id}`,
            name: item.label,
            placementStatus: item.placementStatus,
            block: {
              type: item.attachmentMimeType?.startsWith('image/') ? 'image' : 'file',
              attachmentId: item.attachmentId,
              mimeType: item.attachmentMimeType,
              fileName: item.label,
              size: item.attachmentSize,
            },
          });
        }
      }
    }

    for (const agentId of selectWorkspaceAgentIds.select(state, workspaceId)) {
      const hydrated = selectHydratedBlocks.select(state, agentId);
      const messages = [
        ...selectAgentHistoryMessages.select(state, agentId),
        ...selectAgentMessages.select(state, agentId),
      ];
      for (const message of messages) {
        if (message.role !== 'user') continue;
        for (const [index, source] of (message.contentBlocks ?? []).entries()) {
          if (source.type !== 'image' && !isFileBlock(source)) continue;
          const entry = source.id ? hydrated?.[hydratedBlockKey(message.id, source.id)] : undefined;
          const block = entry?.status === 'loaded' ? entry.block : source;
          append({
            id: `${agentId}/${message.id}/${source.id ?? index}`,
            name: block.fileName,
            block,
            agentId,
            messageId: message.id,
            hydrationStatus: entry?.status,
          });
        }
      }
    }
    return attachments;
  },
);

const selectContextWorkspaceState = store.createSelector<
  [workspaceId: string],
  ContextWorkspaceState
>((state, workspaceId) => {
  return state.context.byWorkspaceId[workspaceId] ?? emptyWorkspaceContextState;
});

export const selectContextItems = store.createSelector<[workspaceId: string], ContextItem[]>(
  (state, workspaceId) => {
    return getItems(selectContextWorkspaceState.select(state, workspaceId).items);
  },
);

export const selectTopLevelContextItems = store.createSelector<
  [workspaceId: string],
  ContextItem[]
>((state, workspaceId) => {
  return selectContextItems.select(state, workspaceId).filter((item) => !item.parentNoteId);
});
