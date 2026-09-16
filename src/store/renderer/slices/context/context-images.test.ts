import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import type { AgentMessage } from '$shared/types';
import { selectWorkspaceContextImages } from './context-selectors';
import {
  initialState,
  transientUiReducer,
  setComposerContextItems,
} from '../transient-ui/transient-ui-slice';
import { selectComposerContextItems } from '../transient-ui/transient-ui-selectors';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { chatStateReducer, messageBlockHydrated } from '../chat-state/chat-state-slice';

function stateWithMessages(messages: AgentMessage[] = []): StoreState {
  return {
    transientUi: initialState,
    workspaceAgents: {
      byWorkspaceId: { one: { agentIds: ['agent-1'] }, two: { agentIds: ['agent-2'] } },
    },
    agentSessions: { byAgentId: { 'agent-1': { messages }, 'agent-2': { messages: [] } } },
    chatState: { byAgentId: {} },
  } as unknown as StoreState;
}

const attachment = {
  id: 'upload',
  type: 'file' as const,
  label: 'landscape.png',
  imageData: 'aW1hZ2U=',
  imageMimeType: 'image/png',
};

describe('workspace context images', () => {
  it('shares draft changes with the composer, isolates workspaces, and removes cleared drafts', () => {
    const state = stateWithMessages();
    state.transientUi = transientUiReducer(
      state.transientUi,
      setComposerContextItems('one', 'agent-1', [attachment]),
    );
    expect(selectComposerContextItems.select(state, 'one', 'agent-1')).toHaveLength(1);
    expect(selectWorkspaceContextImages.select(state, 'one').map((image) => image.name)).toEqual([
      'landscape.png',
    ]);
    expect(selectWorkspaceContextImages.select(state, 'two')).toEqual([]);
    expect(structuredClone(state.transientUi)).toEqual(state.transientUi);
    state.transientUi = transientUiReducer(
      state.transientUi,
      setComposerContextItems('one', 'agent-1', []),
    );
    expect(selectWorkspaceContextImages.select(state, 'one')).toEqual([]);
    expect(
      transientUiReducer(state.transientUi, setComposerContextItems('one', 'agent-1', [])),
    ).toBe(state.transientUi);
  });

  it('keeps sent images after the draft clears and excludes non-images and assistant output', () => {
    const state = stateWithMessages([
      {
        id: 'user',
        role: 'user',
        timestamp: '2026-01-01',
        contentBlocks: [
          { type: 'text', text: 'Review these' },
          { id: 'inline-image', type: 'image', data: attachment.imageData, mimeType: 'image/png' },
          { type: 'image', attachmentId: 'registered-image', fileName: 'diagram.png' },
          { type: 'image', attachmentId: 'registered-image' },
          { type: 'file', attachmentId: 'document', mimeType: 'application/pdf' },
        ],
      },
      {
        id: 'assistant',
        role: 'assistant',
        timestamp: '2026-01-01',
        contentBlocks: [{ type: 'image', data: 'output', mimeType: 'image/png' }],
      },
    ]);
    state.transientUi = transientUiReducer(
      state.transientUi,
      setComposerContextItems('one', 'agent-1', [attachment]),
    );
    expect(selectWorkspaceContextImages.select(state, 'one')).toHaveLength(2);
    state.transientUi = transientUiReducer(
      state.transientUi,
      setComposerContextItems('one', 'agent-1', []),
    );
    expect(
      selectWorkspaceContextImages
        .select(state, 'one')
        .map((image) => image.block.attachmentId ?? image.block.data),
    ).toEqual(['aW1hZ2U=', 'registered-image']);
  });

  it('drops transient attachments when the workspace unmounts', () => {
    const state = stateWithMessages();
    state.transientUi = transientUiReducer(
      state.transientUi,
      setComposerContextItems('one', 'agent-1', [attachment]),
    );
    state.transientUi = transientUiReducer(state.transientUi, workspaceUnmounted('one'));
    expect(selectWorkspaceContextImages.select(state, 'one')).toEqual([]);
  });

  it('keeps distinct slim images and replaces a thumbnail with the hydrated original', () => {
    const state = stateWithMessages([
      {
        id: 'message',
        role: 'user',
        timestamp: '2026-01-01',
        contentBlocks: ['first', 'second'].map((id) => ({
          id,
          type: 'image',
          mimeType: 'image/png',
          data: 'cHJldmlldw==',
          dataTruncated: true,
        })),
      },
    ]);
    expect(selectWorkspaceContextImages.select(state, 'one')).toHaveLength(2);
    const hydrated = {
      ...state,
      chatState: chatStateReducer(
        state.chatState,
        messageBlockHydrated('agent-1', 'message', 'first', {
          id: 'first',
          type: 'image',
          mimeType: 'image/png',
          data: 'b3JpZ2luYWw=',
        }),
      ),
    };
    const images = selectWorkspaceContextImages.select(hydrated, 'one');
    expect(images.map((image) => image.block.data)).toEqual(['b3JpZ2luYWw=', 'cHJldmlldw==']);
    expect(images[0].hydrationStatus).toBe('loaded');
  });
});
