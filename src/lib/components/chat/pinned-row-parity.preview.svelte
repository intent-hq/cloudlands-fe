<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    kind?: 'agent' | 'event' | 'hook' | 'pr' | 'chief';
    narrow?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'pinned-row-parity',
    title: 'Pinned source row parity',
    defaultState: 'agent',
    states: {
      agent: { props: { kind: 'agent' } },
      'long-name': { props: { kind: 'agent', narrow: true } },
      event: { props: { kind: 'event' } },
      hook: { props: { kind: 'hook' } },
      pr: { props: { kind: 'pr' } },
      chief: { props: { kind: 'chief' } },
    },
  });
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import StickyScrollStabilityHost from './__tests__/StickyScrollStabilityHost.svelte';

  let { kind = 'agent', narrow = false }: Props = $props();
  const timestamp = '2026-09-16T12:00:00.000Z';
  const turnMessage: AgentMessage = $derived({
    id: `pinned-parity-${kind}`,
    role: 'user',
    timestamp,
    contentBlocks: [{ type: 'text', text: 'Details are available only in the expanded source.' }],
    metadata:
      kind === 'agent'
        ? {
            type: 'agent_message',
            fromAgentId: 'pinned-parity-sender',
            fromAgentName: narrow
              ? 'Setup modal layout and workspace configuration review'
              : 'Setup modal layout',
          }
        : kind === 'chief'
          ? {
              type: 'chief_message',
              fromAgentId: 'pinned-parity-chief',
              fromWorkspaceId: '__chief__',
              sourceMessageId: 'source-message',
              sourceUrl:
                'intent://local/__chief__/agent/pinned-parity-chief/message/source-message',
            }
          : kind === 'event'
            ? {
                type: 'event_notification',
                eventCount: 1,
                eventTypes: ['agent:idle'],
                events: [
                  {
                    type: 'agent:idle',
                    timestamp,
                    data: {
                      agentId: 'pinned-parity-sender',
                      agentName: 'Setup modal layout',
                      completionReport: 'Details are available only in the expanded source.',
                    },
                  },
                ],
              }
            : kind === 'hook'
              ? {
                  type: 'hook_wake',
                  hookId: 'pinned-parity-hook',
                  hookName: 'Build watch',
                  reason: 'dispatched',
                }
              : { type: 'pr_monitor_wake', repo: 'intent-hq/intent', prNumber: 42 },
  });
</script>

<div class:agent-font-monospace={narrow} data-testid="pinned-row-parity-preview">
  <StickyScrollStabilityHost
    turnMessages={[turnMessage]}
    width={narrow ? 280 : 620}
    responseHeight={600}
  />
</div>
