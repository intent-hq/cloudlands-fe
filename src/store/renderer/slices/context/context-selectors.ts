import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { emptyWorkspaceContextState } from './context-slice';
import type { ContextItem } from '$features/context/types';
import type { ContextImage, ContextWorkspaceState } from './context-types';
import { selectWorkspaceAgentIds } from '../workspace-agents/workspace-agents-selectors';
import {
  selectAgentMessages,
  selectAgentHistoryMessages,
} from '../agent-session/agent-session-selectors';
import { selectWorkspaceComposerContext } from '../transient-ui/transient-ui-selectors';
import { selectHydratedBlocks } from '../chat-state/chat-state-selectors';
import { hydratedBlockKey } from '../chat-state/chat-state-types';

export const selectWorkspaceContextImages = store.createSelector(
  (state, workspaceId: string): ContextImage[] => {
    const images: ContextImage[] = [];
    const seen = new Set<string>();
    const seenInlineData = new Set<string>();
    const append = (image: ContextImage) => {
      // Distinct originals can share a slim thumbnail; dedupe inline bytes only when complete.
      const key = image.block.attachmentId ?? image.id;
      if (seen.has(key)) return;
      if (!image.block.attachmentId && image.block.data && !image.block.dataTruncated) {
        if (seenInlineData.has(image.block.data)) return;
        seenInlineData.add(image.block.data);
      }
      seen.add(key);
      images.push(image);
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
        } else if (item.attachmentId && item.attachmentMimeType?.startsWith('image/')) {
          append({
            id: `draft/${agentId}/${item.id}`,
            name: item.label,
            block: {
              type: 'image',
              attachmentId: item.attachmentId,
              mimeType: item.attachmentMimeType,
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
          if (source.type !== 'image') continue;
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
    return images;
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
