<script lang="ts">
  /**
   * Pinned conversation goal under the chat header: one truncated line with
   * an expand control, Edit (pre-filled editor) and Remove goal. Hidden when
   * no goal is set or the daemon lacks `conversationGoal: 1`. In a shared
   * workspace the label also says who set the goal ("Set by Alice").
   */
  import Fa from 'svelte-fa';
  import { toStore } from 'svelte/store';
  import {
    faChevronDown,
    faChevronUp,
    faFlag,
    faPen,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import { store as appStore } from '$store/renderer/store';
  import { selectConversationGoalSupported } from '$store/renderer/slices/principal/principal-selectors';
  import { selectAgentGoal } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { goalSetRequested } from '../conversation-goal-actions';
  import { selectGoalAttribution } from '../goal-attribution-selectors';
  import { goalStripAttributionLabel } from '../utils/goal-attribution';
  import { goalErrorMessage } from '../utils/goal-error-message';
  import GoalEditorDialog from './GoalEditorDialog.svelte';
  import GoalText from './GoalText.svelte';

  interface Props {
    workspaceId: string | undefined;
    agentId: string | undefined;
    /** Read-only conversations (retired) show the goal without Edit / Remove. */
    readonly?: boolean;
    class?: string;
  }

  let { workspaceId, agentId, readonly = false, class: className }: Props = $props();

  const supported$ = selectConversationGoalSupported();
  const goal$ = selectAgentGoal(toStore(() => agentId ?? ''));
  const goal = $derived($supported$ && agentId && workspaceId ? $goal$ : null);
  const attribution$ = $derived(selectGoalAttribution(workspaceId ?? '', agentId ?? ''));
  const attributionLabel = $derived(
    goal && $attribution$ ? goalStripAttributionLabel($attribution$) : null,
  );

  const contentId = $props.id();
  let expanded = $state(false);
  let editing = $state(false);
  let removing = $state(false);
  let error = $state<string | null>(null);
  let textElement = $state<HTMLElement | null>(null);
  let overflowing = $state(false);

  const expandable = $derived(expanded || overflowing || (goal?.includes('\n') ?? false));

  $effect(() => {
    void goal;
    error = null;
  });

  $effect(() => {
    const element = textElement;
    void goal;
    if (!element || expanded) return;
    const measure = () => {
      overflowing = element.scrollWidth > element.clientWidth + 1;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  async function remove() {
    if (!workspaceId || !agentId || removing) return;
    removing = true;
    error = null;
    try {
      const outcome = await appStore.dispatch(goalSetRequested(workspaceId, agentId, null));
      if (!outcome.ok) error = goalErrorMessage(outcome.error);
    } catch {
      error = m.chat_goal_failed_error();
    } finally {
      removing = false;
    }
  }
</script>

{#if goal && workspaceId && agentId}
  <section
    class={cn('goal-strip border-b border-border bg-background px-3 py-1.5', className)}
    aria-label={m.chat_goalStrip_region_ariaLabel()}
    data-testid="goal-strip"
  >
    <div class="flex min-w-0 items-start gap-2">
      <span
        class="type-caption mt-1 flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground"
      >
        <Fa icon={faFlag} class="size-3" />
        {m.chat_goalStrip_label()}
        {#if attributionLabel}
          <span
            class="max-w-40 truncate font-normal text-subtle"
            title={attributionLabel}
            data-testid="goal-strip-attribution">{attributionLabel}</span
          >
        {/if}
      </span>
      <div
        bind:this={textElement}
        id={contentId}
        class={cn(
          'type-caption mt-1 min-w-0 flex-1 text-foreground',
          expanded ? 'goal-strip-expanded whitespace-pre-wrap break-words' : 'truncate',
        )}
        data-testid="goal-strip-text"
        data-expanded={expanded || undefined}
      >
        <GoalText text={goal} {workspaceId} />
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        {#if expandable}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-label={expanded
              ? m.chat_goalStrip_collapse_ariaLabel()
              : m.chat_goalStrip_expand_ariaLabel()}
            tooltip={expanded
              ? m.chat_goalStrip_collapse_ariaLabel()
              : m.chat_goalStrip_expand_ariaLabel()}
            onclick={() => (expanded = !expanded)}
            ><Fa icon={expanded ? faChevronUp : faChevronDown} /></Button
          >
        {/if}
        {#if !readonly}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.chat_goalStrip_edit_ariaLabel()}
            tooltip={m.chat_goalStrip_edit_ariaLabel()}
            onclick={() => (editing = true)}><Fa icon={faPen} /></Button
          >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.chat_goalStrip_remove_ariaLabel()}
            tooltip={m.chat_goalStrip_remove_ariaLabel()}
            disabled={removing}
            onclick={remove}><Fa icon={faXmark} /></Button
          >
        {/if}
      </div>
    </div>
    {#if error}
      <InputMessage tone="error">{error}</InputMessage>
    {/if}
  </section>
  {#if !readonly}
    <GoalEditorDialog bind:open={editing} {workspaceId} {agentId} initialGoal={goal} />
  {/if}
{/if}

<style>
  .goal-strip-expanded {
    max-height: 10rem;
    overflow-y: auto;
  }
</style>
