<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import {
    faBan,
    faEye,
    faCircleQuestion,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Logo from '$lib/components/Logo.svelte';
  import WorkspaceHoverCard from '$lib/components/workspace/WorkspaceHoverCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { DOCK_RAIL_WIDTH, getDockHorizontalLayout } from '$shared/dock-layout';
  import type {
    DockWorkspaceBadgeKind,
    DockWorkspaceView,
  } from '$store/renderer/slices/hud/hud-selectors';
  import {
    createDockPointerRegionController,
    type DockPointerRegionController,
  } from '$features/hud/utils/dock-pointer-routing';
  import { openDockWorkspace } from '$features/hud/dock-navigation';

  interface Props {
    workspaces: DockWorkspaceView[];
    onOpenWorkspace?: (workspaceId: string) => void | Promise<void>;
    pointerController?: DockPointerRegionController;
  }

  let { workspaces, onOpenWorkspace = openDockWorkspace, pointerController }: Props = $props();

  // The controller owns native window state for this component instance and must not change mid-mount.
  // svelte-ignore state_referenced_locally
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous pointer-region state controller, not a domain-data request
  const pointerRegion = pointerController ?? createDockPointerRegionController();
  const layout = getDockHorizontalLayout();
  let buttonElements = $state<HTMLButtonElement[]>([]);
  const previousBadges = new Map<string, DockWorkspaceBadgeKind>();
  let badgeEpochs = $state<Record<string, number>>({});
  let previewWorkspaceId = $state<string | null>(null);
  let previewTop = $state(8);
  let railHovered = false;
  let previewHovered = false;
  let focusedWorkspaceId: string | null = null;
  let hoveredWorkspaceId: string | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const badgeRank: Record<DockWorkspaceBadgeKind, number> = {
    none: 0,
    review: 1,
    question: 2,
    blocker: 3,
    failure: 4,
  };

  $effect(() => {
    const nextBadges = new Map<string, DockWorkspaceBadgeKind>();
    let nextEpochs: Record<string, number> | null = null;
    for (const item of workspaces) {
      const workspaceId = String(item.workspace.id);
      const previous = previousBadges.get(workspaceId) ?? 'none';
      nextBadges.set(workspaceId, item.badgeKind);
      if (
        item.badgeKind !== 'none' &&
        (previous === 'none' || badgeRank[item.badgeKind] > badgeRank[previous])
      ) {
        nextEpochs ??= { ...badgeEpochs };
        nextEpochs[workspaceId] = (nextEpochs[workspaceId] ?? 0) + 1;
      }
    }
    previousBadges.clear();
    for (const [workspaceId, badge] of nextBadges) previousBadges.set(workspaceId, badge);
    if (nextEpochs) badgeEpochs = nextEpochs;
  });

  const previewWorkspace = $derived(
    workspaces.find((item) => String(item.workspace.id) === previewWorkspaceId) ?? null,
  );

  function initials(title: string | undefined): string {
    const parts = title?.trim().split(/\s+/).filter(Boolean) ?? [];
    return (
      parts
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || 'I'
    );
  }

  function badgeLabel(kind: DockWorkspaceBadgeKind): string {
    if (kind === 'failure') return m.dock_badge_failure_label();
    if (kind === 'blocker') return m.dock_badge_blocker_label();
    if (kind === 'question') return m.dock_badge_question_label();
    return m.dock_badge_review_label();
  }

  function statusLabel(item: DockWorkspaceView): string {
    if (item.badgeKind !== 'none') return badgeLabel(item.badgeKind);
    if (item.isUnread) return m.dock_status_unread_label();
    if (item.isWaiting) return m.dock_status_waiting_label();
    if (item.isRunning) return m.dock_status_running_label();
    return m.dock_status_attention_label();
  }

  function cancelClose(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  }

  function closeIfInactive(): void {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (railHovered || previewHovered || focusedWorkspaceId || hoveredWorkspaceId) return;
      previewWorkspaceId = null;
      pointerRegion.deactivate();
    }, 140);
  }

  function showPreview(workspaceId: string, button: HTMLButtonElement): void {
    cancelClose();
    const top = button.getBoundingClientRect().top - 8;
    previewTop = Math.max(8, Math.min(top, window.innerHeight - 448));
    previewWorkspaceId = workspaceId;
    pointerRegion.activate();
  }

  function handleKeydown(event: KeyboardEvent, workspaceId: string): void {
    const index = workspaces.findIndex((item) => String(item.workspace.id) === workspaceId);
    if (event.key === 'Escape') {
      previewWorkspaceId = null;
      pointerRegion.deactivate();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? workspaces.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + workspaces.length) % workspaces.length;
    buttonElements[nextIndex]?.focus();
  }

  function openWorkspace(workspaceId: string): void {
    previewWorkspaceId = null;
    pointerRegion.deactivate();
    void Promise.resolve(onOpenWorkspace(workspaceId)).catch(() => undefined);
  }

  onDestroy(() => {
    cancelClose();
    pointerRegion.destroy();
  });
</script>

<div class="dock-shell" data-testid="dock-shell">
  <div
    class="dock-rail"
    role="navigation"
    aria-label={m.dock_workspaces_ariaLabel()}
    style:width={`${DOCK_RAIL_WIDTH}px`}
    onpointerenter={() => {
      railHovered = true;
      cancelClose();
      pointerRegion.activate();
    }}
    onpointerleave={() => {
      railHovered = false;
      closeIfInactive();
    }}
    data-testid="dock-rail"
  >
    {#if workspaces.length === 0}
      <div
        class="dock-empty"
        role="status"
        aria-label={m.dock_empty_tooltip()}
        title={m.dock_empty_tooltip()}
        data-testid="dock-empty"
      >
        <Logo width={22} />
      </div>
    {:else}
      <ul class="dock-list" aria-label={m.dock_workspaces_ariaLabel()}>
        {#each workspaces as item, index (item.workspace.id)}
          {@const workspaceId = String(item.workspace.id)}
          {@const title = item.workspace.title?.trim() || m.workspace_links_untitled_label()}
          <li out:fade={{ delay: 140, duration: 80 }} data-dock-entry={workspaceId}>
            <button
              bind:this={buttonElements[index]}
              type="button"
              class="dock-workspace-button"
              aria-label={m.dock_workspaceButton_ariaLabel({
                name: title,
                status: statusLabel(item),
              })}
              aria-expanded={previewWorkspaceId === workspaceId}
              aria-controls={previewWorkspaceId === workspaceId
                ? 'dock-workspace-preview'
                : undefined}
              onpointerenter={(event) => {
                hoveredWorkspaceId = workspaceId;
                showPreview(workspaceId, event.currentTarget);
              }}
              onpointerleave={() => {
                hoveredWorkspaceId = null;
                closeIfInactive();
              }}
              onfocus={(event) => {
                focusedWorkspaceId = workspaceId;
                showPreview(workspaceId, event.currentTarget);
              }}
              onblur={() => {
                focusedWorkspaceId = null;
                closeIfInactive();
              }}
              onkeydown={(event) => handleKeydown(event, workspaceId)}
              onclick={() => openWorkspace(workspaceId)}
              data-workspace-id={workspaceId}
            >
              <span aria-hidden="true">{initials(title)}</span>
              {#if item.isUnread}
                <span class="dock-unread" aria-hidden="true"></span>
              {/if}
              {#if item.badgeKind !== 'none'}
                {#key `${workspaceId}:${badgeEpochs[workspaceId] ?? 0}`}
                  <span
                    class="dock-badge"
                    data-badge-kind={item.badgeKind}
                    data-badge-animated={(badgeEpochs[workspaceId] ?? 0) > 0}
                    aria-hidden="true"
                  >
                    <Fa
                      icon={item.badgeKind === 'failure'
                        ? faTriangleExclamation
                        : item.badgeKind === 'blocker'
                          ? faBan
                          : item.badgeKind === 'question'
                            ? faCircleQuestion
                            : faEye}
                      size={10}
                    />
                  </span>
                {/key}
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if previewWorkspace}
    <div
      id="dock-workspace-preview"
      class="dock-preview"
      role="presentation"
      style:left={`${layout.preview.x}px`}
      style:width={`${layout.preview.width}px`}
      style:top={`${previewTop}px`}
      onpointerenter={() => {
        previewHovered = true;
        cancelClose();
        pointerRegion.activate();
      }}
      onpointerleave={() => {
        previewHovered = false;
        closeIfInactive();
      }}
      data-testid="dock-preview"
    >
      <WorkspaceHoverCard workspace={previewWorkspace.workspace} />
    </div>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    background: transparent !important;
  }
  .dock-shell {
    position: relative;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    color: hsl(var(--foreground));
  }
  .dock-rail {
    position: absolute;
    inset: 0 0 0 auto;
    display: grid;
    align-content: start;
    justify-items: center;
    padding: 10px 8px;
    background: hsl(var(--background) / 0.86);
    border-left: 1px solid hsl(var(--border));
    backdrop-filter: blur(18px);
    pointer-events: auto;
  }
  .dock-list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dock-workspace-button,
  .dock-empty {
    position: relative;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid hsl(var(--border));
    border-radius: 9999px;
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    font-size: 12px;
    font-weight: 700;
  }
  .dock-workspace-button {
    cursor: pointer;
    outline: none;
  }
  .dock-workspace-button:hover {
    background: hsl(var(--muted));
  }
  .dock-workspace-button:focus-visible {
    box-shadow: 0 0 0 3px hsl(var(--ring));
  }
  .dock-unread {
    position: absolute;
    right: 1px;
    bottom: 2px;
    width: 8px;
    height: 8px;
    border: 2px solid hsl(var(--card));
    border-radius: 9999px;
    background: hsl(var(--primary));
  }
  .dock-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    display: grid;
    width: 19px;
    height: 19px;
    place-items: center;
    border: 2px solid hsl(var(--background));
    border-radius: 9999px;
    background: hsl(var(--destructive));
    color: hsl(var(--destructive-foreground));
    animation: dock-badge-enter 180ms ease-out both;
  }
  .dock-badge[data-badge-kind='question'],
  .dock-badge[data-badge-kind='review'] {
    background: hsl(var(--warning));
    color: hsl(var(--warning-foreground));
  }
  .dock-preview {
    position: absolute;
    pointer-events: auto;
  }
  @keyframes dock-badge-enter {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dock-badge {
      animation: none;
    }
  }
  @media (forced-colors: active) {
    .dock-rail,
    .dock-workspace-button,
    .dock-empty,
    .dock-badge {
      border-color: CanvasText;
    }
    .dock-workspace-button:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
      box-shadow: none;
    }
  }
</style>
