<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import AttentionRequestBanner from './AttentionRequestBanner.svelte';
  import { store } from '$store/renderer/store';
  import {
    updateSession,
    bulkUpsertSessions,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { AgentSession } from '$shared/types';

  interface Props {
    attention?: 'blocker' | 'discussion' | null;
  }

  export const preview = definePreview<Props>({
    id: 'attention-composer',
    title: 'Pending attention card',
    defaultState: 'discussion',
    states: {
      discussion: { props: { attention: 'discussion' } },
      blocker: { props: { attention: 'blocker' } },
      resolved: { props: { attention: null } },
    },
  });
</script>

<script lang="ts">
  let { attention = 'discussion' }: Props = $props();
  const agentId = 'preview-attention-card';
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        workspaceId: 'preview-attention',
        name: 'Preview agent',
        status: 'idle',
        messages: [],
        createdAt: '2026-09-16T12:00:00Z',
        updatedAt: '2026-09-16T12:00:00Z',
      } as unknown as AgentSession,
    ]),
  );
  $effect(() => {
    store.dispatch(
      updateSession(agentId, {
        attentionRequestKind: attention ?? undefined,
        attentionRequestReason: attention
          ? 'Please review the fixture plan before continuing. This explanation should remain readable in a narrow panel.'
          : undefined,
        attentionRequestTimestamp: attention ? '2026-09-16T12:00:00Z' : undefined,
      }),
    );
  });
</script>

<div class="w-full min-w-0">
  <AttentionRequestBanner {agentId} />
</div>
