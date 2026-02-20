<script lang="ts">
  /**
   * Agent Summary Card
   *
   * A reusable component for displaying agent summaries in various contexts.
   * Can be used in lists, popups, drawers, etc.
   *
   * Features:
   * - Compact or expanded view modes
   * - Shows agent status, model, and activity
   * - Displays file changes and message counts
   * - Supports background agent indicators
   * - Click to select/open agent
   */

  import {
    faRobot,
    faClock,
    faFile,
    faMessage,
    faGear,
    faCheck,
    faSpinner,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import type { AgentSession } from '$shared/types';
  import { AgentStatus } from '$shared/types';
  import { cn } from '$lib/utils/cn';

  interface Props {
    agent: AgentSession;
    variant?: 'compact' | 'expanded' | 'minimal';
    showFileChanges?: boolean;
    fileChanges?: {
      additions: number;
      deletions: number;
      filesChanged: number;
    };
    onClick?: () => void;
    isSelected?: boolean;
    className?: string;
  }

  let {
    agent,
    variant = 'compact',
    showFileChanges = true,
    fileChanges,
    onClick,
    isSelected = false,
    className = '',
  }: Props = $props();

  // Derive agent info
  let isBackground = $derived(agent.metadata?.isBackground || agent.isBackground);
  let triggerType = $derived(agent.metadata?.triggerType);
  let messageCount = $derived(agent.messages?.length || 0);
  let lastActivity = $derived(
    agent.lastActivity
      ? formatDistanceToNow(new Date(agent.lastActivity), { addSuffix: true })
      : 'No activity',
  );

  // Extract last message preview
  let lastMessage = $derived.by(() => {
    if (!agent.messages || agent.messages.length === 0) return null;
    const lastMsg = agent.messages[agent.messages.length - 1];

    // Extract text content from contentBlocks
    let textContent = '';
    if (lastMsg.contentBlocks && lastMsg.contentBlocks.length > 0) {
      textContent = lastMsg.contentBlocks
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join(' ');
    }

    if (lastMsg.role === 'user') {
      return { type: 'user', content: textContent };
    } else if (lastMsg.role === 'assistant') {
      // Truncate assistant message
      return {
        type: 'assistant',
        content: textContent.length > 100 ? textContent.slice(0, 100) + '...' : textContent,
      };
    }
    return null;
  });

  // Status icon and color
  let statusIcon = $derived(
    agent.status === AgentStatus.Active || agent.status === AgentStatus.Processing
      ? faSpinner
      : agent.status === AgentStatus.Completed || agent.status === AgentStatus.Idle
        ? faCheck
        : agent.status === AgentStatus.Error
          ? faExclamationTriangle
          : faClock,
  );

  let statusColor = $derived(
    agent.status === AgentStatus.Active || agent.status === AgentStatus.Processing
      ? 'text-blue-500'
      : agent.status === AgentStatus.Completed || agent.status === AgentStatus.Idle
        ? 'text-green-500'
        : agent.status === AgentStatus.Error
          ? 'text-red-500'
          : 'text-muted-foreground',
  );

  // Handle keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  }
</script>

<button
  class={cn(
    'w-full text-left transition-all duration-200 group',
    variant === 'minimal' ? 'p-2' : variant === 'compact' ? 'p-3' : 'p-4',
    'rounded-lg border bg-card hover:bg-muted/50',
    isSelected && 'ring-2 ring-primary',
    isBackground && 'bg-muted/20 border-dashed',
    className,
  )}
  onclick={onClick}
  onkeydown={handleKeyDown}
  disabled={!onClick}
  role={onClick ? 'button' : undefined}
  tabindex={onClick ? 0 : -1}
  aria-label={`Agent: ${agent.name}`}
>
  <div class="flex items-start gap-3">
    <!-- Avatar -->
    <div class="flex-none">
      <AuggieAvatar
        size={variant === 'minimal' ? 24 : variant === 'compact' ? 32 : 40}
        faceSeed={agent.id}
        colorSeed={agent.id}
      />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 mb-1">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class={cn('font-medium truncate', variant === 'minimal' ? 'text-xs' : 'text-sm')}>
              {agent.name}
            </h3>
            {#if isBackground}
              <span class="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Background
              </span>
            {/if}
            {#if triggerType}
              <span class="text-xs text-muted-foreground">
                <Fa icon={faGear} size="xs" class="mr-1" />
                {triggerType}
              </span>
            {/if}
          </div>
          {#if variant !== 'minimal'}
            <div class="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{agent.model}</span>
              <span>•</span>
              <span class="flex items-center gap-1">
                <Fa icon={faClock} size="xs" />
                {lastActivity}
              </span>
            </div>
          {/if}
        </div>

        <!-- Status Icon -->
        <div class={cn('flex-none', statusColor)}>
          <Fa
            icon={statusIcon}
            size={variant === 'minimal' ? 'xs' : 'sm'}
            class={agent.status === AgentStatus.Active || agent.status === AgentStatus.Processing
              ? 'animate-spin'
              : ''}
          />
        </div>
      </div>

      <!-- Message Preview (expanded view only) -->
      {#if variant === 'expanded' && lastMessage}
        <div class="mt-2 p-2 rounded bg-muted/50 text-xs">
          <div class="flex items-start gap-2">
            <span class="font-medium text-muted-foreground">
              {lastMessage.type === 'user' ? 'User:' : 'Agent:'}
            </span>
            <span class="flex-1 line-clamp-2">
              {lastMessage.content}
            </span>
          </div>
        </div>
      {/if}

      <!-- Stats -->
      {#if variant !== 'minimal'}
        <div class="flex items-center gap-3 mt-2 text-xs">
          {#if messageCount > 0}
            <div class="flex items-center gap-1 text-muted-foreground">
              <Fa icon={faMessage} size="xs" />
              <span>{messageCount} message{messageCount !== 1 ? 's' : ''}</span>
            </div>
          {/if}

          {#if showFileChanges && fileChanges && (fileChanges.additions > 0 || fileChanges.deletions > 0)}
            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1 text-muted-foreground">
                <Fa icon={faFile} size="xs" />
                <span
                  >{fileChanges.filesChanged} file{fileChanges.filesChanged !== 1 ? 's' : ''}</span
                >
              </div>
              <LineChangesBadge
                additions={fileChanges.additions}
                deletions={fileChanges.deletions}
                size="xs"
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</button>
