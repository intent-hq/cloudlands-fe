<script lang="ts" module>
  import { dockConversationPreview } from './dock-conversation.preview-fixtures';
  export const preview = dockConversationPreview;
</script>

<script lang="ts">
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import DockConversationPanel from './DockConversationPanel.svelte';
  import type { DockConversationMessage } from '$store/renderer/slices/dock-conversation/dock-conversation-types';
  import {
    conversationAgents,
    conversationMessages,
    type DockConversationPreviewProps,
  } from './dock-conversation.preview-fixtures';

  let {
    agent = conversationAgents[0],
    agents = conversationAgents,
    workspaceTitle = 'Make workspace navigation feel effortless',
    messages: initialMessages = conversationMessages,
    queuedMessages = [],
    initialDraft = '',
    width = 420,
    height = 520,
    loading: initialLoading = false,
    running = false,
    sending = false,
    loadError: initialLoadError,
    sendError: initialSendError,
    blocked = false,
    attention,
    theme = 'light',
  }: DockConversationPreviewProps = $props();

  // svelte-ignore state_referenced_locally -- synchronized by the effect below.
  let selectedAgent = $state(agent);
  let drafts = $state<Record<string, string>>({});
  let messages = $state<DockConversationMessage[]>([]);
  let loading = $state(false);
  let loadError = $state<string>();
  let sendError = $state<string>();
  let actions = $state<string[]>([]);
  let submissions = $state<{ agentId: string; text: string }[]>([]);
  $effect(() => {
    selectedAgent = agent;
  });
  $effect(() => {
    drafts = { [agent.id]: initialDraft };
  });
  $effect(() => {
    messages = initialMessages;
  });
  $effect(() => {
    loading = initialLoading;
    loadError = initialLoadError;
    sendError = initialSendError;
  });
  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });
  // Explicit fake stream boundary for deterministic browser fixtures, never a live service.
  $effect(() => {
    const receive = (event: Event) => {
      const message = (event as CustomEvent<DockConversationMessage>).detail;
      messages = [...messages.filter((item) => item.id !== message.id), message];
    };
    window.addEventListener('dock-conversation-preview-message', receive);
    return () => window.removeEventListener('dock-conversation-preview-message', receive);
  });
  function send(): void {
    const text = drafts[selectedAgent.id] ?? '';
    submissions = [...submissions, { agentId: selectedAgent.id, text }];
    messages = [
      ...messages,
      {
        id: `preview-sent-${submissions.length}`,
        role: 'user',
        timestamp: new Date(catalogNow()).toISOString(),
        contentBlocks: [{ type: 'text', text }],
      },
    ];
    drafts = { ...drafts, [selectedAgent.id]: '' };
    sendError = undefined;
    actions = [...actions, 'send'];
  }
</script>

<div
  class="preview-host"
  style:width={`${width}px`}
  style:height={`${height}px`}
  data-dock-conversation-preview
  data-preview-actions={JSON.stringify(actions)}
  data-preview-submissions={JSON.stringify(submissions)}
  data-preview-drafts={JSON.stringify(drafts)}
>
  <DockConversationPanel
    conversationKey={selectedAgent.id}
    agentId={selectedAgent.id}
    agents={agents.length ? agents : [selectedAgent]}
    {workspaceTitle}
    {messages}
    {queuedMessages}
    draft={drafts[selectedAgent.id] ?? ''}
    {loading}
    {running}
    {sending}
    error={loadError}
    {sendError}
    {blocked}
    {attention}
    onDraftChange={(value) => (drafts = { ...drafts, [selectedAgent.id]: value })}
    onSend={send}
    onRetrySend={send}
    onSelectAgent={(id) => {
      const next = agents.find((item) => item.id === id);
      if (next) selectedAgent = next;
      actions = [...actions, `agent:${id}`];
    }}
    onBack={() => (actions = [...actions, 'back'])}
    onOpenWorkspace={() => (actions = [...actions, `open:${selectedAgent.id}`])}
    onRetryLoad={() => {
      loading = false;
      loadError = undefined;
      messages = conversationMessages;
      actions = [...actions, 'retry-load'];
    }}
  />
</div>

<style>
  .preview-host {
    max-width: 100%;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
  }
</style>
