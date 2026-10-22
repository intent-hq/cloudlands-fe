<script lang="ts">
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { formatTime, formatFullDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionAgentActivity } from '$shared/types/workspace-discussion';

  let {
    messageId,
    activity,
    name,
    disabled = false,
    pending = false,
    onStop,
    onRetry,
  }: {
    messageId: string;
    activity: DiscussionAgentActivity;
    name: string;
    disabled?: boolean;
    pending?: boolean;
    onStop?: () => void;
    onRetry?: () => void;
  } = $props();
  const active = $derived(activity.state === 'queued' || activity.state === 'working');
  const failed = $derived(activity.state === 'failed');
  const label = $derived(
    activity.state === 'queued'
      ? m.workspace_discussion_agentQueued_label()
      : activity.state === 'working'
        ? m.workspace_discussion_agentResponding_label()
        : failed
          ? m.workspace_discussion_agentFailed_label()
          : m.workspace_discussion_agentStopped_label(),
  );
</script>

{#if activity.state !== 'completed'}
  <div
    class="flex min-w-0 items-start gap-3 px-2 py-[7px]"
    data-discussion-agent-activity={activity.agentId}
    data-discussion-activity-message={messageId}
    data-discussion-activity-state={activity.state}
  >
    <div
      class="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted"
    >
      <AgentAvatar agentId={activity.agentId} variant="emphasized" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1 type-caption">
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <span class="truncate font-medium text-foreground">{name}</span>
        <Badge
          size="compact"
          class="h-4 rounded-[5px] px-[5px] leading-[14px] text-muted-foreground"
          >{m.workspace_fileChanges_agent_label()}</Badge
        >
        <span class="text-muted-foreground" aria-hidden="true">·</span>
        <time
          class="text-muted-foreground"
          datetime={activity.updatedAt}
          title={formatFullDateTime(activity.updatedAt)}>{formatTime(activity.updatedAt)}</time
        >
      </div>
      <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        <span class:text-danger={failed} role="status">{label}</span>
        {#if active ? onStop : onRetry}
          <span aria-hidden="true">·</span>
          <Button
            variant="plain"
            size="compact"
            class="h-auto"
            disabled={disabled || pending}
            loading={pending}
            onclick={active ? onStop : onRetry}
            aria-label={active
              ? m.workspace_discussion_stopAgent_label({ name })
              : m.workspace_discussion_retryAgent_label({ name })}
            >{active ? m.workspace_discussion_stop_label() : m.ui_errorToast_retry_label()}</Button
          >
        {/if}
      </div>
      {#if !active}
        <p class="m-0 text-muted-foreground">{m.workspace_discussion_agentEnded_description()}</p>
      {/if}
    </div>
  </div>
{/if}
