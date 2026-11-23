<script lang="ts">
  /**
   * Transcript row for a daemon-persisted `goal_command` row, drawn as the
   * same centered inline divider as model-change notices: one truncated line
   * (full goal on hover) that expands below to the full goal (links
   * clickable). Notices never edit the goal: the goal strip owns Edit and
   * Remove. In a shared workspace the row also says who wrote it
   * (`fromPrincipalId`).
   */
  import { faFlag } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import ChatInlineDivider from '$lib/components/chat/ChatInlineDivider.svelte';
  import { animatedHeight } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import type { GoalNoticeInfo } from '../utils/goal-command';
  import { selectGoalAttribution } from '../goal-attribution-selectors';
  import { goalNoticeAttributionLabel } from '../utils/goal-attribution';
  import GoalText from './GoalText.svelte';

  interface Props {
    notice: GoalNoticeInfo;
    /** The row's text content, shown when the metadata cannot be described. */
    fallbackText?: string;
    workspaceId?: string;
    agentId?: string;
  }

  let { notice, fallbackText, workspaceId, agentId }: Props = $props();

  let expanded = $state(false);
  // Collapsing keeps the details mounted until the height animation ends.
  let detailsRetained = $state(false);
  $effect(() => {
    if (expanded) detailsRetained = true;
  });
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
  // Unattributed rows (personal workspaces, unknown writers) never fall back
  // to the agent's current `goalSetBy`: that may name a later writer.
  const attribution$ = $derived(
    notice.fromPrincipalId
      ? selectGoalAttribution(workspaceId ?? '', agentId ?? '', notice.fromPrincipalId)
      : null,
  );
  const attributionLabel = $derived(
    attribution$ && $attribution$ ? goalNoticeAttributionLabel($attribution$) : null,
  );
  // The toggle's name carries the attribution, so the visible copy is hidden
  // from screen readers on rows with a toggle.
  const rowLabel = $derived(
    attributionLabel
      ? m.chat_goalNotice_attributed_ariaLabel({ text, attribution: attributionLabel })
      : text,
  );
</script>

<div class="goal-notice my-4 min-w-0" data-testid="goal-notice">
  <!-- A row holding the expand control is not a live region. -->
  <ChatInlineDivider icon={faFlag} class="my-0" role={notice.goal ? null : 'status'}>
    {#if notice.goal}
      <Button
        variant="plain"
        class="h-auto min-w-0 shrink justify-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        title={text}
        aria-label={rowLabel}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onclick={() => (expanded = !expanded)}
        ><span class="min-w-0 truncate" data-testid="goal-notice-text">{text}</span></Button
      >
    {:else}
      <span class="min-w-0 truncate" title={text} data-testid="goal-notice-text">{text}</span>
    {/if}
    {#if attributionLabel}
      <span
        class="max-w-40 flex-shrink-0 truncate opacity-80"
        title={attributionLabel}
        aria-hidden={notice.goal ? 'true' : undefined}
        data-testid="goal-notice-attribution">{attributionLabel}</span
      >
    {/if}
  </ChatInlineDivider>
  {#if notice.goal}
    <div
      id={detailsId}
      inert={!expanded}
      aria-hidden={!expanded}
      use:animatedHeight={{
        open: expanded,
        onClosed: () => {
          if (!expanded) detailsRetained = false;
        },
      }}
    >
      {#if expanded || detailsRetained}
        <div
          class="mx-auto max-w-prose whitespace-pre-wrap px-7 pt-2 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]"
          data-testid="goal-notice-details"
        >
          <GoalText {text} {workspaceId} />
        </div>
      {/if}
    </div>
  {/if}
</div>
