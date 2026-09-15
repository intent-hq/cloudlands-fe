<!--
  ActivityTimelineItem - Individual timeline event with sleek design

  Features:
  - Icon on left with timeline connector
  - Natural language description with inline entity chips
  - Relative timestamp
  - Optional expandable details
  - Status indicators
-->

<script lang="ts">
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { faCheckCircle, faXmarkCircle } from '@fortawesome/free-solid-svg-icons';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { slide } from '$lib/motion';
  import type { Snippet } from 'svelte';

  type Status = 'success' | 'error' | 'pending' | 'neutral';

  interface Props {
    icon: IconDefinition;
    timestamp: string | Date;
    status?: Status;
    isAgent?: boolean;
    agentId?: string;
    showConnector?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isExpanded?: boolean;
    onClick?: () => void;
    onAgentClick?: () => void;
    children: Snippet;
    details?: Snippet;
    class?: string;
  }

  let {
    icon,
    timestamp,
    status = 'neutral',
    isAgent = false,
    agentId,
    showConnector = true,
    isLast = false,
    isExpanded = false,
    onClick,
    onAgentClick,
    children,
    details,
    class: className,
  }: Props = $props();

  // Status icon mapping
  const statusIcons: Record<Status, IconDefinition | null> = {
    success: faCheckCircle,
    error: faXmarkCircle,
    pending: null,
    neutral: null,
  };

  const statusColors: Record<Status, string> = {
    success: 'text-green-500',
    error: 'text-danger',
    pending: 'text-warning-ink',
    neutral: '',
  };

  let statusIcon = $derived(statusIcons[status]);
</script>

<div class={cn('group relative flex items-start gap-3 py-1.5 px-2', className)}>
  <!-- Timeline connector line -->
  {#if showConnector && !isLast}
    <div class="absolute left-[18px] top-8 bottom-0 w-px bg-border" aria-hidden="true"></div>
  {/if}

  <!-- Icon container -->
  <div class="relative z-10 flex items-center justify-center w-5 h-5 mt-0.5 shrink-0">
    {#if status === 'pending'}
      <IntentMarkLoader size={14} class={statusColors.pending} />
    {:else if statusIcon}
      <Fa icon={statusIcon} class={cn('text-sm', statusColors[status])} />
    {:else}
      <Fa {icon} class="text-sm text-ghost" />
    {/if}
  </div>

  <!-- Content -->
  <Button
    type="button"
    variant="ghost"
    class="flex-1 min-w-0 text-left cursor-pointer group/content"
    onclick={onClick}
  >
    <!-- Main text with inline children -->
    <div
      class="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm text-subtle leading-relaxed"
    >
      {@render children()}

      <!-- Timestamp -->
      <span class="text-xs text-subtle ml-1">
        · <RelativeTime date={timestamp} compact />
      </span>
    </div>
  </Button>

  <!-- Agent avatar (right side) -->
  {#if isAgent && agentId}
    <Button
      type="button"
      variant="ghost"
      class="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
      onclick={onAgentClick}
    >
      <AgentAvatar variant="standard" {agentId} />
    </Button>
  {/if}
</div>

<!-- Expanded details -->
{#if isExpanded && details}
  <div transition:slide={{ axis: 'y', tier: 'moderate' }} class="ml-8 mr-2 py-2">
    {@render details()}
  </div>
{/if}
