<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { AgentSession } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import AttentionRequestBanner from '../AttentionRequestBanner.svelte';

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    kind = 'blocker',
    reason = 'A detailed reason that can wrap onto more than one line without overlapping the header.',
    timestamp = '2026-08-25T12:00:00.000Z',
  }: {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    kind?: 'blocker' | 'discussion';
    reason?: string;
    timestamp?: string;
  } = $props();

  const fixture = untrack(() => ({ kind, reason, timestamp }));
  const agentId = `attention-banner-${fixture.kind}`;
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(
    bulkUpsertSessions(
      [
        {
          id: agentId,
          workspaceId: 'attention-banner-geometry',
          name: 'Attention banner agent',
          status: 'active',
          messages: [],
          attentionRequestKind: fixture.kind,
          attentionRequestReason: fixture.reason || undefined,
          attentionRequestTimestamp: fixture.timestamp || undefined,
          createdAt: '2026-08-25T00:00:00.000Z',
          updatedAt: '2026-08-25T00:00:00.000Z',
        } as unknown as AgentSession,
      ],
      { preserveExplicitRuntimeFlags: false },
    ),
  );
  onDestroy(disposeStore);
</script>

<section class:dark={theme === 'dark'} style:zoom data-testid="attention-banner-geometry-host">
  <div class="bg-background text-foreground" style:width="{width}px">
    <div class="h-8" data-testid="preceding-chat-content">Previous chat content</div>
    <AttentionRequestBanner {agentId} />
  </div>
</section>
