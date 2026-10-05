<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import AttentionRequestBanner from '../AttentionRequestBanner.svelte';
  import BlockerReportNotice from '../BlockerReportNotice.svelte';
  import DiscussionRequestNotice from '../DiscussionRequestNotice.svelte';
  import TurnFailureNotice from '../TurnFailureNotice.svelte';
  import InterruptionNotice from '../InterruptionNotice.svelte';
  import StreamingMessageContent from '../StreamingMessageContent.svelte';

  let {
    theme = 'light',
    width = 420,
    zoom = 1,
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  } = $props();

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

  const reason =
    'The release checks need your review before work can continue. Choose the next step when you are ready.';
  const timestamp = '2026-08-25T12:00:00.000Z';
  const variants = [
    'active-blocker',
    'history-blocker',
    'active-discussion',
    'history-discussion',
    'failure',
    'interruption',
  ];
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(
    bulkUpsertSessions(
      ['blocker', 'discussion'].map(
        (kind) =>
          ({
            id: `notice-consistency-${kind}`,
            workspaceId: 'notice-consistency',
            name: 'Notice preview agent',
            status: 'active',
            messages: [],
            attentionRequestKind: kind,
            attentionRequestReason: reason,
            attentionRequestTimestamp: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          }) as unknown as AgentSession,
      ),
      { preserveExplicitRuntimeFlags: false },
    ),
  );
  onDestroy(disposeStore);
</script>

<section style:zoom data-testid="notice-consistency-host">
  <div
    class="grid grid-cols-2 gap-8 bg-background p-6 text-foreground"
    style:width="{width * 2 + 80}px"
    data-notice-surface
  >
    {#each variants as variant}
      <section class="flex min-w-0 flex-col" style:width="{width}px" data-notice-variant={variant}>
        <div class="h-8" data-preceding-content>
          <StreamingMessageContent
            content={[{ type: 'text', text: variant }]}
            isStreaming={false}
          />
        </div>
        {#if variant === 'active-blocker'}
          <AttentionRequestBanner agentId="notice-consistency-blocker" />
        {:else if variant === 'history-blocker'}
          <BlockerReportNotice {reason} />
        {:else if variant === 'active-discussion'}
          <AttentionRequestBanner agentId="notice-consistency-discussion" />
        {:else if variant === 'history-discussion'}
          <DiscussionRequestNotice {reason} />
        {:else if variant === 'failure'}
          <TurnFailureNotice {reason} />
        {:else}
          <InterruptionNotice />
        {/if}
      </section>
    {/each}
  </div>
</section>
