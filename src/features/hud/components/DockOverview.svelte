<script lang="ts">
  import { workspaceRepositoryLabel } from '$lib/components/workspace/utils/workspace-repository-label';
  import { Button } from '$lib/components/ui/button';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DockWorkspaceAvatar from './DockWorkspaceAvatar.svelte';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { formatCompactRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import { keepDockFocusVisible, revealDockItem } from '$features/hud/utils/dock-scroll';

  let {
    workspaces,
    pending = false,
    onOpen,
  }: {
    workspaces: DockWorkspaceView[];
    pending?: boolean;
    onOpen: (id: string) => void;
  } = $props();
  // The list fades at its bottom edge only while more rows sit below it.
  let moreBelow = $state(false);
  function trackOverflow(node: HTMLElement, _rows: number) {
    const update = () => {
      moreBelow = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return {
      // Rows changed: measure after they render.
      update: () => requestAnimationFrame(update),
      destroy() {
        node.removeEventListener('scroll', update);
        observer.disconnect();
      },
    };
  }
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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  class="dock-overview"
  aria-label={m.dock_workspaces_ariaLabel()}
  onkeydown={navigate}
  onfocusin={(event) => revealDockItem(event.target as HTMLElement)}
  data-testid="dock-overview"
>
  <div
    class="overview-rows"
    class:more-below={moreBelow}
    data-dock-scroll
    use:keepDockFocusVisible
    use:trackOverflow={workspaces.length}
  >
    {#each workspaces as item (item.workspace.id)}
      {@const id = String(item.workspace.id)}
      {@const title = item.workspace.title?.trim() || m.workspace_links_untitled_label()}
      {@const state = resolveWorkspaceStatusState(item.workspace)}
      {@const status = getWorkspaceStatusPresentation(state)}
      {@const repo = workspaceRepositoryLabel(item.workspace)}
      {@const message = item.workspace.statusMessage?.trim() ?? ''}
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
            <!-- The repo identifies the row; rows without one keep their status line. -->
            <span class="row-status type-caption" id="dock-status-{id}">
              {#if repo}<span class="row-repo truncate" title={repo} data-dock-row-repo>{repo}</span
                >{:else}<span
                  class="row-message truncate"
                  title={message || status.label}
                  data-dock-row-message>{message || status.label}</span
                >{/if}
              <span class="sr-only">{status.accessibleName}</span>
            </span>
          </span>
        </Button>
        <span class="row-time type-caption" title={item.workspace.updatedAt}>
          {item.workspace.updatedAt ? formatCompactRelativeTime(item.workspace.updatedAt) : ''}
        </span>
      </div>
    {/each}
  </div>
  <!-- The Assistant is set apart below the workspaces, always in view. -->
  <div class="assistant-divider" role="presentation"></div>
  <div class="overview-row assistant-row">
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
    flex: 0 1 auto;
    overflow: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }
  .overview-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    align-items: center;
    column-gap: 8px;
    min-height: 52px;
    border-radius: var(--radius-medium);
  }
  /* Between the emphasized and prominent steps: legible beside two lines of text. */
  .dock-overview :global([data-avatar-variant]) {
    --agent-avatar-surface-size: 32px;
    --agent-avatar-art-size: 26px;
    --agent-avatar-clear-space: 3px;
    --agent-avatar-corner-radius: 9px;
  }
  .overview-rows.more-below {
    mask-image: linear-gradient(to bottom, black calc(100% - 28px), transparent);
  }
  .assistant-divider {
    flex: none;
    height: 1px;
    margin: 2px 6px 4px;
    background: hsl(var(--border));
  }
  .assistant-row {
    flex: none;
    min-height: 40px;
  }
  .assistant-row :global(.overview-open) {
    height: 40px;
  }
  @media (hover: hover) {
    .overview-row:hover:has(:global(.overview-open:not(:disabled))) {
      background-color: hsl(var(--hover));
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
    gap: 12px;
    padding: 4px 6px;
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
  .row-repo {
    flex: 0 1 auto;
    min-width: 0;
  }
  .row-message {
    flex: 1 1000 0;
    min-width: 0;
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
