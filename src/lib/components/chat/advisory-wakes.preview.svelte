<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Variant =
    | 'genuine-finish'
    | 'one-pr'
    | 'two-prs'
    | 'many-prs'
    | 'hooks-only'
    | 'script-only'
    | 'repeat-run'
    | 'two-agents'
    | 'mixed-run'
    | 'expanded'
    | 'long-name'
    | 'malformed-refs'
    | 'duplicate-prs'
    | 'cross-repo'
    | 'unknown-agent'
    | 'false-flag';

  const variants: Variant[] = [
    'genuine-finish',
    'one-pr',
    'two-prs',
    'many-prs',
    'hooks-only',
    'script-only',
    'repeat-run',
    'two-agents',
    'mixed-run',
    'expanded',
    'long-name',
    'malformed-refs',
    'duplicate-prs',
    'cross-repo',
    'unknown-agent',
    'false-flag',
  ];

  export const preview = definePreview<{ variant?: Variant }>({
    id: 'advisory-wakes',
    title: 'Advisory wakes',
    defaultState: 'repeat-run',
    states: Object.fromEntries(
      variants.map((variant) => [variant, { props: { variant } }]),
    ) as Record<Variant, { props: { variant: Variant } }>,
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AgentMessage } from '$shared/types';
  import type { Workspace } from '$shared/types';
  import ChatMessage from './ChatMessage.svelte';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import { indexConversationTurns } from './conversation-turns';

  let { variant = 'repeat-run' }: { variant?: Variant } = $props();

  const workspace = { id: 'preview-advisory-wakes' } as Workspace;
  const builder = { id: 'agent-builder-preview', name: 'Simplify the issue alert email' };
  const reviewer = { id: 'agent-reviewer-preview', name: 'Alert severity settings' };
  const longAgent = {
    id: 'agent-long-preview',
    name: 'Port the weekly digest email to the shared template and verify every client',
  };
  const pr = (prNumber: number, title: string) => ({
    monitorId: `monitor-${prNumber}`,
    repo: 'acme/app',
    prNumber,
    title,
  });
  const prs = [
    pr(779, 'Match the alert email to the new design'),
    pr(797, 'Let people choose alert severities'),
    pr(803, 'Send digests in the recipient time zone'),
    pr(811, 'Drop the legacy alert template'),
  ];
  const hooks = [{ hookId: 'hook-1', name: 'Wait for the staging deploy' }];
  const scripts = [
    { scriptName: 'e2e-alert-email', runId: 'run-1', expiresAt: '2026-11-20T23:30:00.000Z' },
  ];

  let sequence = 0;
  function wake(
    agent: { id: string; name: string },
    waiting: Record<string, unknown> | null,
  ): AgentMessage {
    sequence += 1;
    const timestamp = new Date(Date.UTC(2026, 10, 20, 22, 20, sequence * 20)).toISOString();
    return {
      id: `advisory-${variant}-${sequence}`,
      role: 'user',
      timestamp,
      contentBlocks: [{ type: 'text', text: '[WORKSPACE EVENTS]' }],
      metadata: {
        type: 'event_notification',
        eventCount: 1,
        eventTypes: ['agent:idle'],
        ...(waiting ? { watchStillArmed: true, childExternallyWaiting: true, ...waiting } : {}),
        events: [
          {
            type: 'agent:idle',
            timestamp,
            data: {
              agentId: agent.id,
              agentName: agent.name,
              reason: waiting ? 'harness_wake_complete' : 'turn_complete',
              status: 'idle',
            },
          },
        ],
      },
    } as AgentMessage;
  }

  function reply(text: string): AgentMessage {
    sequence += 1;
    return {
      id: `reply-${variant}-${sequence}`,
      role: 'assistant',
      timestamp: new Date(Date.UTC(2026, 10, 20, 22, 20, sequence * 20)).toISOString(),
      contentBlocks: [{ type: 'text', text }],
    } as AgentMessage;
  }

  const onePr = { waitingOnPrMonitors: prs.slice(0, 1) };
  const twoPrs = { waitingOnPrMonitors: prs.slice(0, 2) };

  function messagesFor(current: Variant): AgentMessage[] {
    sequence = 0;
    switch (current) {
      case 'genuine-finish':
        return [wake(builder, null)];
      case 'one-pr':
        return [wake(builder, onePr)];
      case 'two-prs':
        return [wake(builder, twoPrs)];
      case 'many-prs':
        return [wake(builder, { waitingOnPrMonitors: prs })];
      case 'hooks-only':
        return [wake(builder, { waitingOnHooks: hooks })];
      case 'script-only':
        return [wake(builder, { waitingOnScriptMonitors: scripts })];
      case 'repeat-run':
        return Array.from({ length: 5 }, () => wake(builder, twoPrs));
      case 'two-agents':
        return [
          wake(builder, twoPrs),
          wake(reviewer, onePr),
          wake(builder, twoPrs),
          wake(reviewer, onePr),
        ];
      case 'mixed-run':
        return [
          wake(builder, onePr),
          wake(builder, onePr),
          reply('No change. Both pull requests are still in review.'),
          wake(builder, onePr),
          wake(builder, twoPrs),
          wake(builder, twoPrs),
          wake(builder, null),
        ];
      case 'expanded':
        return [wake(builder, twoPrs)];
      case 'malformed-refs':
        return [
          wake(builder, {
            waitingOnPrMonitors: [
              null,
              {},
              { prNumber: '779' },
              { repo: 'acme/app', prNumber: -1 },
            ],
          }),
        ];
      case 'duplicate-prs':
        return [wake(builder, { waitingOnPrMonitors: [prs[1], prs[0], prs[1]] })];
      case 'cross-repo':
        return [
          wake(builder, {
            waitingOnPrMonitors: [prs[0], { ...prs[0], monitorId: 'other-repo', repo: 'acme/web' }],
          }),
        ];
      case 'unknown-agent':
        return [wake({ id: 'agent-unknown-preview', name: '' }, onePr)];
      case 'false-flag':
        return [wake(builder, { ...onePr, childExternallyWaiting: false })];
      case 'long-name':
        return [wake(longAgent, twoPrs), wake(longAgent, twoPrs), wake(longAgent, null)];
    }
  }

  const turns = $derived(
    indexConversationTurns([{ messages: messagesFor(variant), groupKey: variant }]).groups[0]
      ?.turns ?? [],
  );

  let root: HTMLElement | undefined = $state();
  onMount(() => {
    if (variant !== 'expanded') return;
    void tick().then(() =>
      root?.querySelector<HTMLElement>('[data-testid="event-wakeup-summary"]')?.click(),
    );
  });
</script>

<section
  bind:this={root}
  class="flex w-full min-w-0 flex-col gap-4 bg-background p-4 text-foreground"
  data-testid="advisory-wakes-preview"
>
  {#each turns as turn (turn.foldedMessages?.[0]?.id ?? turn.userMessage?.id ?? turn.bodyMessages[0]?.id)}
    {#if turn.userMessage}
      <EventWakeupBanner
        metadata={turn.userMessage.metadata as never}
        asDivider
        suppressTopGap
        {workspace}
      />
    {/if}
    {#each turn.bodyMessages as message (message.id)}
      <ChatMessage {message} />
    {/each}
  {/each}
</section>
