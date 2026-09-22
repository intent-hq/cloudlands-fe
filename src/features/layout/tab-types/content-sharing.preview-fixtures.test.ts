import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { selectAgentMessages } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { markAgentAsViewed } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { selectAwaitingSwitchBackSnapshot } from '$store/renderer/slices/chat-state/chat-state-selectors';
import { requestSubscriptionFetch } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { selectAgentSubscriptionLane } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
import { backgroundHooksSubscribeRequested } from '$store/renderer/slices/background-hooks/background-hooks-slice';
import { selectBackgroundHooksSnapshotStatus } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
import { prMonitorsSubscribeRequested } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
import { selectPrMonitorsSnapshotStatus } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
import { isNoteContentStale } from '$shared/utils/note-content';
import { conversationMarkdown, hasConversationText } from '$features/export/conversation-markdown';
import {
  seedSharingPreview,
  SHARING_AGENT_ID,
  SHARING_NOTE_ID,
  SHARING_WORKSPACE_ID,
} from './content-sharing.preview-fixtures';

describe('content sharing preview fixtures through production export consumers', () => {
  let dispose: () => void;
  beforeAll(() => {
    dispose = store.init();
  });
  afterAll(() => dispose());

  it('keeps empty background facets settled after the real view requests its subscriptions', () => {
    seedSharingPreview('ready');
    store.dispatch(requestSubscriptionFetch(SHARING_WORKSPACE_ID, SHARING_AGENT_ID));
    store.dispatch(backgroundHooksSubscribeRequested(SHARING_WORKSPACE_ID));
    store.dispatch(prMonitorsSubscribeRequested(SHARING_WORKSPACE_ID));
    expect(
      selectAgentSubscriptionLane.select(store.state, SHARING_WORKSPACE_ID, SHARING_AGENT_ID)
        .visible,
    ).toBe(false);
    expect(selectBackgroundHooksSnapshotStatus.select(store.state, SHARING_WORKSPACE_ID)).toBe(
      'ready',
    );
    expect(selectPrMonitorsSnapshotStatus.select(store.state, SHARING_WORKSPACE_ID)).toBe('ready');
  });

  it('keeps the transcript visible when the real panel marks the fixture agent viewed', () => {
    seedSharingPreview('ready');
    store.dispatch(markAgentAsViewed(SHARING_AGENT_ID));
    expect(selectAwaitingSwitchBackSnapshot.select(store.state, SHARING_AGENT_ID)).toBe(false);
  });

  it('exports both roles from the loaded and streaming chat scenes', () => {
    for (const state of ['ready', 'chat-streaming'] as const) {
      seedSharingPreview(state);
      const messages = selectAgentMessages.select(store.state, SHARING_AGENT_ID);
      expect(hasConversationText(messages)).toBe(true);
      const markdown = conversationMarkdown(messages);
      expect(markdown).toContain('## User\n\nPlease summarize');
      expect(markdown).toContain('## Assistant\n\n## Ready to share');
    }
  });

  it('does not export the previous scene after switching to an empty chat', () => {
    seedSharingPreview('ready');
    seedSharingPreview('chat-empty');
    const messages = selectAgentMessages.select(store.state, SHARING_AGENT_ID);
    expect(hasConversationText(messages)).toBe(false);
    expect(conversationMarkdown(messages)).toBe('');
  });

  it('distinguishes a slim stale note from a genuinely empty note', () => {
    seedSharingPreview('note-stale');
    expect(
      isNoteContentStale(selectNoteById.select(store.state, SHARING_WORKSPACE_ID, SHARING_NOTE_ID)),
    ).toBe(true);
    seedSharingPreview('note-empty');
    expect(
      isNoteContentStale(selectNoteById.select(store.state, SHARING_WORKSPACE_ID, SHARING_NOTE_ID)),
    ).toBe(false);
  });
});
