<script lang="ts">
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DockWorkspaceAvatar from './DockWorkspaceAvatar.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { formatCompactRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import { keepDockFocusVisible, revealDockItem } from '$features/hud/utils/dock-scroll';
  import { faPen } from '$lib/icons/phosphor-icons';

  let {
    workspaces,
    pending = false,
    onOpen,
    onFeedback,
  }: {
    workspaces: DockWorkspaceView[];
    pending?: boolean;
    onOpen: (id: string) => void;
    onFeedback: (id: string, title: string) => void;
  } = $props();
  function navigate(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const root = event.currentTarget as HTMLElement;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dock-row]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
    if (buttons[next]) revealDockItem(buttons[next]);
  }
</script>

{#snippet feedbackIcon()}<Fa icon={faPen} class="size-4" />{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  class="dock-overview"
  aria-label={m.dock_workspaces_ariaLabel()}
  onkeydown={navigate}
  onfocusin={(event) => revealDockItem(event.target as HTMLElement)}
  data-testid="dock-overview"
>
  <div class="overview-rows" data-dock-scroll use:keepDockFocusVisible>
    <div class="overview-row" data-dock-scroll-item>
      <Button
        variant="plain"
        size="sm"
        class="overview-open"
        wrapContent={false}
        disabled={pending}
        data-dock-row
        data-workspace-id="dock:assistant"
        onclick={() => onOpen('dock:assistant')}
      >
        <AgentAvatar specialist="chief-of-staff" variant="emphasized" />
        <span class="row-copy"
          ><span class="type-body font-medium">{m.dock_assistant_label()}</span></span
        >
      </Button>
      <span class="row-time" aria-hidden="true"></span>
      <Button
        variant="ghost"
        size="icon-sm"
        class="overview-feedback"
        iconOnly
        aria-label={`${m.dock_feedback_label()}: ${m.dock_assistant_label()}`}
        title={`${m.dock_feedback_label()}: ${m.dock_assistant_label()}`}
        data-testid="dock-row-feedback"
        data-workspace-id="dock:assistant"
        disabled={pending}
        onclick={() => onFeedback('dock:assistant', m.dock_assistant_label())}
      >
        {@render feedbackIcon()}
      </Button>
    </div>
    {#each workspaces as item (item.workspace.id)}
      {@const id = String(item.workspace.id)}
      {@const title = item.workspace.title?.trim() || m.workspace_links_untitled_label()}
      {@const state = resolveWorkspaceStatusState(item.workspace)}
      {@const status = getWorkspaceStatusPresentation(state)}
      <div class="overview-row" data-dock-scroll-item data-running={item.isRunning}>
        <Button
          variant="plain"
          size="sm"
          class="overview-open"
          wrapContent={false}
          disabled={pending}
          data-dock-row
          data-workspace-id={id}
          aria-describedby="dock-status-{id}"
          onclick={() => onOpen(id)}
        >
          <DockWorkspaceAvatar {item} variant="emphasized" />
          <span class="row-copy">
            <span class="type-body font-medium truncate" {title}>{title}</span>
            <span class="row-status type-caption" id="dock-status-{id}">
              <WorkspaceStatusIcon status={state} size={12} decorative />
              <span class="truncate" title={item.workspace.statusMessage?.trim() || status.label}
                >{item.workspace.statusMessage?.trim() || status.label}</span
              >
              <span class="sr-only">{status.accessibleName}</span>
            </span>
          </span>
        </Button>
        <span class="row-time type-caption" title={item.workspace.updatedAt}>
          {item.workspace.updatedAt ? formatCompactRelativeTime(item.workspace.updatedAt) : ''}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="overview-feedback"
          iconOnly
          aria-label={`${m.dock_feedback_label()}: ${title}`}
          title={`${m.dock_feedback_label()}: ${title}`}
          data-testid="dock-row-feedback"
          data-workspace-id={id}
          disabled={pending}
          onclick={() => onFeedback(id, title)}
        >
          {@render feedbackIcon()}
        </Button>
      </div>
    {/each}
  </div>
</nav>

<style>
  .dock-overview {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .overview-rows {
    overflow: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }
  .overview-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px 28px;
    align-items: center;
    column-gap: 8px;
    min-height: 52px;
    border-radius: var(--radius-medium);
  }
  @media (hover: hover) {
    .overview-row :global(.overview-feedback) {
      opacity: 0;
      pointer-events: none;
    }
    .overview-row:hover :global(.overview-feedback),
    .overview-row:has(:global(:focus-visible)) :global(.overview-feedback) {
      opacity: 1;
      pointer-events: auto;
    }
    .overview-row:hover:has(:global(.overview-open:not(:disabled))) {
      background-color: hsl(var(--hover));
    }
    .overview-row :global(.overview-feedback:hover:not(:disabled)) {
      background-color: hsl(var(--active));
    }
  }
  .dock-overview :global(button:not(:disabled)) {
    cursor: pointer;
  }
  .overview-row:has(:global(.overview-open:active:not(:disabled))) {
    background-color: hsl(var(--active));
  }
  :global(.overview-open) {
    width: 100%;
    min-width: 0;
    height: 52px;
    justify-content: flex-start;
    gap: 10px;
    padding: 4px;
    color: inherit;
  }
  .row-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 2px;
    overflow: hidden;
  }
  .row-copy > span {
    max-width: 100%;
  }
  .row-status {
    display: flex;
    align-items: center;
    gap: 5px;
    color: hsl(var(--muted-foreground));
    width: 100%;
  }
  .row-time {
    color: hsl(var(--muted-foreground));
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
</style>
