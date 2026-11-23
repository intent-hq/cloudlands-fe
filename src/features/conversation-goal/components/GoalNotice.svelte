<script lang="ts">
  /**
   * Transcript row for a daemon-persisted `goal_command` row, in the shared
   * left-aligned operational row pattern: one truncated line that expands to
   * the full goal (links clickable). A "Current goal" row offers Edit.
   */
  import Fa from 'svelte-fa';
  import { toStore } from 'svelte/store';
  import { faFlag } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ChatOperationalRow from '$lib/components/chat/ChatOperationalRow.svelte';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
  } from '$lib/components/chat/operational-disclosure-row';
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
  let expanded = $state(false);
  const detailsId = $props.id();

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
  const text = $derived(label ?? fallbackText ?? m.chat_goalNotice_fallback_label());
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

{#snippet leading()}
  <Fa icon={faFlag} class="{CHAT_OPERATIONAL_ICON_CLASS} text-subtle opacity-50" />
{/snippet}
{#snippet summary()}
  <span data-testid="goal-notice-text">{text}</span>
{/snippet}
{#snippet trailing()}
  {#if canEdit}
    <Button
      variant="link"
      size="sm"
      class="h-auto p-0 type-caption"
      aria-label={m.chat_goalStrip_edit_ariaLabel()}
      onclick={() => (editing = true)}>{m.chat_goalNotice_edit_label()}</Button
    >
  {/if}
{/snippet}
{#snippet detailsBody()}
  <div class="whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="goal-notice-details">
    <GoalText {text} {workspaceId} />
  </div>
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  {trailing}
  details={notice.goal ? detailsBody : undefined}
  animateDetailsHeight
  interactive={!!notice.goal}
  {expanded}
  controls={notice.goal ? detailsId : undefined}
  {detailsId}
  ariaLabel={text}
  onclick={() => (expanded = !expanded)}
  detailsClass="{OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground"
  testId="goal-notice"
  class="goal-notice my-1"
/>
{#if canEdit && workspaceId && agentId}
  <GoalEditorDialog
    bind:open={editing}
    {workspaceId}
    {agentId}
    initialGoal={$currentGoal$ ?? notice.goal ?? ''}
  />
{/if}
