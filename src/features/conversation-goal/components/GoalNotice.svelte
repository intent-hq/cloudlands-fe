<script lang="ts">
  /**
   * Centered inline notice for a daemon-persisted `goal_command` row (like the
   * model-change notice). A "Current goal" row offers Edit.
   */
  import Fa from 'svelte-fa';
  import { toStore } from 'svelte/store';
  import { faFlag } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { selectConversationGoalSupported } from '$store/renderer/slices/principal/principal-selectors';
  import {
    selectAgentGoal,
    selectAgentRetired,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { GoalNoticeInfo } from '../utils/goal-command';
  import GoalEditorDialog from './GoalEditorDialog.svelte';
  import GoalText from './GoalText.svelte';

  interface Props {
    notice: GoalNoticeInfo;
    /** The row's text content, shown when the metadata cannot be described. */
    fallbackText?: string;
    workspaceId?: string;
    agentId?: string;
    /** Retired conversations are read-only: no Edit. */
    readonly?: boolean;
  }

  let { notice, fallbackText, workspaceId, agentId, readonly = false }: Props = $props();

  const supported$ = selectConversationGoalSupported();
  const agentId$ = toStore(() => agentId ?? '');
  const currentGoal$ = selectAgentGoal(agentId$);
  // Retired conversations are read-only even when the transcript host does
  // not pass `readonly` (the chat panel renders rows without it).
  const retired$ = selectAgentRetired(agentId$);
  let editing = $state(false);

  const label = $derived.by((): string | null => {
    const goal = notice.goal;
    switch (notice.action) {
      case 'set':
        return goal ? m.chat_goalNotice_set_label({ goal }) : null;
      case 'updated':
        return goal ? m.chat_goalNotice_updated_label({ goal }) : null;
      case 'unchanged':
        return goal ? m.chat_goalNotice_unchanged_label({ goal }) : null;
      case 'shown':
        return goal ? m.chat_goalNotice_current_label({ goal }) : m.chat_goalNotice_none_label();
      case 'cleared':
        return m.chat_goalNotice_cleared_label();
    }
  });
  const canEdit = $derived(
    !readonly &&
      !$retired$ &&
      $supported$ &&
      !!workspaceId &&
      !!agentId &&
      notice.action === 'shown' &&
      notice.goal !== null,
  );
</script>

<div class="goal-notice my-4 flex w-full min-w-0 items-center gap-3" role="status">
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa icon={faFlag} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 whitespace-pre-wrap break-words" data-testid="goal-notice-text"
      ><GoalText
        text={label ?? fallbackText ?? m.chat_goalNotice_fallback_label()}
        {workspaceId}
      /></span
    >
    {#if canEdit}
      <Button
        variant="link"
        size="sm"
        class="h-auto p-0 text-xs"
        aria-label={m.chat_goalStrip_edit_ariaLabel()}
        onclick={() => (editing = true)}>{m.chat_goalNotice_edit_label()}</Button
      >
    {/if}
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
{#if canEdit && workspaceId && agentId}
  <GoalEditorDialog
    bind:open={editing}
    {workspaceId}
    {agentId}
    initialGoal={$currentGoal$ ?? notice.goal ?? ''}
  />
{/if}
