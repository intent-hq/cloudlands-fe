<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { MessageAuthor, QueuedMessage } from '$shared/types';
  import type { QueuedMessageSendOutcome } from '$store/renderer/slices/chat-state/chat-state-types';
  import QueuedMessageList from './QueuedMessageList.svelte';
  import EventSubscriptionsCard from './EventSubscriptionsCard.svelte';
  import SimpleRichInput from './input/SimpleRichInput.svelte';

  interface Props {
    messageCount?: number;
    heldCount?: number;
    heldStart?: number;
    retry?: boolean;
    disabled?: boolean;
    longContent?: boolean;
    contentKind?: 'plain' | 'multiline' | 'attachments' | 'attachments-only' | 'member';
    showAuthors?: boolean;
    sendOutcome?: QueuedMessageSendOutcome | 'pending' | 'failed';
    clearFails?: boolean;
    docked?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'queued-messages',
    title: 'Queued messages',
    defaultState: 'multiple',
    states: {
      empty: { props: { messageCount: 0 } },
      single: { props: { messageCount: 1 } },
      multiple: { props: { messageCount: 3 } },
      many: { props: { messageCount: 12 } },
      docked: { props: { messageCount: 12, docked: true } },
      'single-held': { props: { messageCount: 1, heldCount: 1 } },
      'held-for-editing': { props: { messageCount: 3, heldCount: 1 } },
      'held-in-middle': { props: { messageCount: 3, heldCount: 1, heldStart: 1 } },
      'held-last': { props: { messageCount: 3, heldCount: 1, heldStart: 2 } },
      'all-held': { props: { messageCount: 2, heldCount: 2 } },
      retry: { props: { messageCount: 2, retry: true } },
      disabled: { props: { messageCount: 3, disabled: true } },
      'long-content': { props: { messageCount: 3, longContent: true } },
      multiline: { props: { messageCount: 3, contentKind: 'multiline' } },
      attachments: { props: { messageCount: 3, contentKind: 'attachments' } },
      'attachments-only': { props: { messageCount: 3, contentKind: 'attachments-only' } },
      'member-mention': { props: { messageCount: 2, contentKind: 'member' } },
      'shared-authors': { props: { messageCount: 3, showAuthors: true } },
      sending: { props: { messageCount: 3, sendOutcome: 'pending' } },
      'still-queued': { props: { messageCount: 2, sendOutcome: 'queued' } },
      'recovery-required': { props: { messageCount: 2, sendOutcome: 'quarantined' } },
      'send-failed': { props: { messageCount: 2, sendOutcome: 'failed' } },
      'awaiting-removal': { props: { messageCount: 2, sendOutcome: 'delivered' } },
      'clear-failed': { props: { messageCount: 3, clearFails: true } },
    },
  });
</script>

<script lang="ts">
  let {
    messageCount = 3,
    heldCount = 0,
    heldStart = 0,
    retry = false,
    disabled = false,
    longContent = false,
    contentKind = 'plain',
    showAuthors = false,
    sendOutcome,
    clearFails = false,
    docked = false,
  }: Props = $props();
  const people: MessageAuthor[] = [
    { principalId: 'preview-self', login: 'you', displayName: 'You', avatarUrl: null },
    {
      principalId: 'preview-guest',
      login: 'alex',
      displayName: 'Alexandra with a long display name',
      avatarUrl: null,
    },
    { principalId: 'preview-unknown', login: null, displayName: null, avatarUrl: null },
  ];
  const authors = $derived(
    showAuthors ? new Map(people.map((person) => [person.principalId, person])) : null,
  );
  const imageData = btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#e2e8f0"/><path d="M4 52 28 24 44 42 60 18 76 52" fill="#64748b"/></svg>',
  );
  const memberToken = `@member[${btoa(
    JSON.stringify({
      label: 'alex.dev',
      principalId: 'preview-guest',
      workspaceId: 'preview-workspace',
      identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
    }),
  )}]`;

  function messageContent(index: number) {
    if (contentKind === 'attachments-only') return '';
    if (contentKind === 'member') return `Ask ${memberToken} to review the changes.`;
    if (contentKind === 'multiline')
      return 'Check the queue header.\nKeep the controls easy to reach.\nInclude the empty state.';
    if (longContent)
      return 'Please check that a long queued message stays readable and its actions remain available in a narrow chat panel.';
    return [
      'Check the empty state too.',
      'Keep the spacing consistent.',
      'Add a keyboard navigation test.',
    ][index % 3];
  }

  function attachments(index: number): Pick<QueuedMessage, 'imageBlocks' | 'fileBlocks'> {
    if (contentKind !== 'attachments' && contentKind !== 'attachments-only') return {};
    if (index === 0)
      return { imageBlocks: [{ type: 'image', data: imageData, mimeType: 'image/svg+xml' }] };
    if (index === 1)
      return {
        imageBlocks: [{ type: 'image', attachmentId: 'preview-unresolved', mimeType: 'image/png' }],
      };
    return {
      fileBlocks: [
        {
          type: 'file',
          attachmentId: 'preview-file',
          fileName: 'Queue layout review.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };
  }

  let messages = $state<QueuedMessage[]>([]);
  let draft = $state('');
  $effect(() => {
    messages = Array.from({ length: messageCount }, (_, i) => ({
      id: `preview-queue-${i}`,
      content: messageContent(i),
      ...attachments(i),
      queuedAt: '2026-09-16T12:00:00.000Z',
      position: i,
      editing: i >= heldStart && i < heldStart + heldCount,
      requeuedAfterFailure: retry && i === 0,
      author: showAuthors ? people[i % people.length] : undefined,
    }));
  });

  function remove(id: string) {
    messages = messages.filter((message) => message.id !== id);
  }

  async function sendNow(id: string): Promise<QueuedMessageSendOutcome | void> {
    if (sendOutcome === 'pending') return new Promise(() => undefined);
    if (sendOutcome === 'failed') throw new Error('Connection unavailable');
    if (sendOutcome) return sendOutcome;
    remove(id);
  }

  async function sendAll(ids: string[]): Promise<QueuedMessageSendOutcome | void> {
    if (sendOutcome === 'pending') return new Promise(() => undefined);
    if (sendOutcome === 'failed') throw new Error('Connection unavailable');
    if (sendOutcome) return sendOutcome;
    messages = messages.filter((message) => !ids.includes(message.id));
  }

  async function clearAll(ids: string[]) {
    if (clearFails) throw new Error('Connection unavailable');
    messages = messages.filter((message) => !ids.includes(message.id));
  }
</script>

{#snippet queue()}
  <QueuedMessageList
    {messages}
    {disabled}
    {authors}
    ownPrincipalId="preview-self"
    onedit={async (id, content, editing) => {
      messages = messages.map((message) =>
        message.id === id ? { ...message, content, editing } : message,
      );
      return { success: true };
    }}
    onremove={remove}
    onsendnow={sendNow}
    onsendall={sendAll}
    onclearall={clearAll}
  />
{/snippet}

{#if docked}
  <div
    class="group/panel flex h-[560px] w-full flex-col justify-end"
    data-testid="queued-messages-docked-preview"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div class="mt-auto" style:--queued-messages-max-height="280px">
        <div class="has-[>_*]:pb-2">{@render queue()}</div>
        <EventSubscriptionsCard
          workspaceId="queue-preview"
          agentId="queue-preview"
          isolatedPreview={{ count: 2, initiallyExpanded: false }}
        />
      </div>
    </div>
    <div class="shrink-0">
      <SimpleRichInput bind:value={draft} workspace={null} />
    </div>
  </div>
{:else}
  {@render queue()}
{/if}
