<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'effort-change-notice',
    title: 'Effort change notices',
    defaultState: 'transcript',
    states: { transcript: { props: {} } },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import AgentMessageList from './AgentMessageList.svelte';

  const message = (
    id: string,
    role: AgentMessage['role'],
    text: string,
    metadata?: Record<string, unknown>,
  ): AgentMessage => ({
    id,
    role,
    timestamp: '2026-09-26T12:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    metadata,
  });

  const messages: AgentMessage[] = [
    message('user', 'user', 'Please review the implementation carefully.'),
    message('effort', 'system', 'Effort changed from medium to high.', {
      type: 'effort_changed',
      from: 'medium',
      to: 'high',
    }),
    message('reply', 'assistant', 'I’ll check the implementation and its tests.'),
    message('auto-off', 'system', 'Effort changed from auto to none.', {
      type: 'effort_changed',
      from: null,
      to: 'none',
    }),
    message('unknown', 'system', 'Effort changed to a custom provider level.', {
      type: 'effort_changed',
      from: 'high',
      to: 'Provider-defined extended reasoning',
    }),
    message('fallback', 'system', 'Saved effort explanation from the daemon.', {
      type: 'effort_changed',
    }),
  ];
</script>

<div class="w-full bg-background text-foreground" data-testid="effort-transcript">
  <AgentMessageList {messages} enableTransitions={false} />
</div>
