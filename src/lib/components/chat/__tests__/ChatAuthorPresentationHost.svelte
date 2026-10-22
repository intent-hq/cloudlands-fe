<script lang="ts">
  import ChatMessage from '../ChatMessage.svelte';
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import type { AgentMessage, MessageAuthor } from '$shared/types/agent-message';
  import { createMockWorkspace } from '../../../../test/factories/workspace.factory';
  import { buildCollaboratorSenderPreamble } from '$lib/utils/collaborator-sender-attribution';

  let { host = 'forge.example:8443', width = 720 }: { host?: string; width?: number } = $props();
  const workspace = createMockWorkspace({ ownerPrincipalId: 'owner', memberCount: 2 });
  const authors = $derived<MessageAuthor[]>([
    {
      principalId: null,
      displayName: 'The Octocat',
      login: 'octocat',
      avatarUrl: null,
      identity: { provider: 'github', host: 'github.com', externalUserId: '526899' },
    },
    {
      principalId: null,
      displayName: 'Same Person',
      login: 'same',
      avatarUrl: null,
      identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '526899' },
    },
    {
      principalId: 'member',
      displayName: 'Same Person',
      login: 'same',
      avatarUrl: null,
      identity: { provider: 'gitlab', host, externalUserId: '526899' },
    },
    { principalId: null, displayName: null, login: null, avatarUrl: null },
    { principalId: 'owner', displayName: 'Owner Person', login: 'owner', avatarUrl: null },
  ]);
  const messages = $derived<AgentMessage[]>(
    authors.map((author, i) => ({
      id: `author-${i}`,
      role: 'user',
      timestamp: '2026-10-03T00:00:00.000Z',
      author,
      metadata: { fromPrincipalId: author.principalId ?? 'imported' },
      contentBlocks: [
        {
          type: 'text',
          text:
            (i === 2
              ? buildCollaboratorSenderPreamble(author.login, author.displayName, 'member', {
                  role: 'member',
                  identity: author.identity,
                }) + '\n\n'
              : '') + 'Please review this change.',
        },
      ],
    })),
  );
</script>

<div
  class="bg-background text-foreground p-4"
  style:width="{width}px"
  data-testid="chat-author-preview"
>
  {#each messages as message (message.id)}
    <ChatMessage {message} {workspace} ownPrincipalId="viewer" />
  {/each}
  <QueuedMessageList
    ownPrincipalId="viewer"
    authors={new Map([['member', authors[2]]])}
    messages={authors.map((author, i) => ({
      id: `queue-${i}`,
      content: 'Please review this queued change.',
      author,
      messageMetadata: { fromPrincipalId: author.principalId ?? 'imported' },
      queuedAt: '2026-10-03T00:00:00.000Z',
      position: i,
    }))}
  />
</div>
