import type { ComponentProps } from 'svelte';
import type { AgentMessage } from '$shared/types';
import { definePreview } from '$lib/component-catalog/preview-definition';
import { getUserMessageNavigationItems } from './chat-message-navigation';
import ChatMessageNavigator from './ChatMessageNavigator.svelte';

// Mixed conversation input follows the production user-message projection.
const messages: AgentMessage[] = [
  ['user', 'Inspect the workspace sidebar actions.'],
  ['assistant', 'I will inspect the shared header controls.'],
  ['user', 'Keep the Context, Changes and Files headings aligned.'],
  ['assistant', 'The three panels now use the same header anatomy.'],
  ['user', 'Check the model picker with several providers.'],
  ['user', 'Compare the search field in light and dark themes.'],
  ['user', 'Verify keyboard navigation through this message menu.'],
].map(([role, text], index) => ({
  id: `preview-message-${index}`,
  role: role as AgentMessage['role'],
  timestamp: '2026-01-01T00:00:00.000Z',
  contentBlocks: [{ type: 'text', text }],
}));

export const preview = definePreview<ComponentProps<typeof ChatMessageNavigator>>({
  id: 'chat-message-navigator',
  title: 'Chat message navigator',
  defaultState: 'populated',
  states: {
    populated: {
      props: {
        messages: getUserMessageNavigationItems(messages),
        isAtBottom: false,
        onSelectMessage: () => true,
        onScrollToBottom: () => undefined,
      },
    },
  },
});

export default ChatMessageNavigator;
