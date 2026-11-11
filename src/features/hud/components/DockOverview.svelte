<script lang="ts">
  import { tick } from 'svelte';
  import { workspaceRepositoryLabel } from '$lib/components/workspace/utils/workspace-repository-label';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DockWorkspaceAvatar from './DockWorkspaceAvatar.svelte';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from '$lib/components/workspace/utils/workspace-status-presentation';
  import { formatCompactRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import { keepDockFocusVisible, revealDockItem } from '$features/hud/utils/dock-scroll';
  import DockIntroCard from '$features/hud/intro/DockIntroCard.svelte';
  import { dockIntro, releaseDockIntroHold } from '$features/hud/intro/dock-intro.svelte';
  import { DOCK_OVERVIEW_HISTORY_HEIGHT } from './dock-shell-geometry';

  let {
    workspaces,
    olderWorkspaces = [],
    showOlder = $bindable(false),
    pending = false,
    onOpen,
    query = $bindable(''),
  }: {
    workspaces: DockWorkspaceView[];
    olderWorkspaces?: DockWorkspaceView[];
    showOlder?: boolean;
    pending?: boolean;
    onOpen: (id: string) => void;
    /** The search text; the shell keeps it across a conversation and clears it on a full close. */
    query?: string;
  } = $props();
  const rowsId = $props.id();
  const searchId = `${rowsId}-search`;
  // Search: title, repository label and owner; while searching, older rows are included.
  let searchInput = $state<HTMLElement | null>(null);
  const needle = $derived(query.trim().toLocaleLowerCase());
  const searching = $derived(needle.length > 0);
  function matches(item: DockWorkspaceView): boolean {
    const fields = [
      item.workspace.title,
      workspaceRepositoryLabel(item.workspace),
      item.workspace.repositoryOwner,
      item.workspace.repositoryName,
    ];
    return fields.some((field) => !!field && field.toLocaleLowerCase().includes(needle));
  }
  const visibleWorkspaces = $derived(
    searching
      ? [...workspaces, ...olderWorkspaces].filter(matches)
      : showOlder
        ? [...workspaces, ...olderWorkspaces]
        : workspaces,
  );
  let rows = $state<HTMLDivElement>();
  let historyButton = $state<HTMLButtonElement | null>(null);
  let assistantButton = $state<HTMLButtonElement | null>(null);
  // A recency refresh can remove the last older row and its focused disclosure.
  $effect.pre(() => {
    if (olderWorkspaces.length > 0) return;
    showOlder = false;
    const previous = historyButton;
    if (previous && document.activeElement === previous) {
      void tick().then(() => {
        if (!previous.isConnected && document.activeElement === document.body)
          assistantButton?.focus({ preventScroll: true });
      });
    }
  });
  async function revealOlder(): Promise<void> {
    const previous = historyButton;
    const hadFocus = document.activeElement === previous;
    showOlder = true;
    await tick();
    if (hadFocus && previous && !previous.isConnected && document.activeElement === document.body) {
      const target =
        rows?.querySelectorAll<HTMLButtonElement>('[data-workspace-id]')[workspaces.length];
      target?.focus({ preventScroll: true });
      if (target) revealDockItem(target);
    }
  }
  // Opening a workspace or the Assistant ends the intro's hold on the open notch.
  function openRow(id: string): void {
    releaseDockIntroHold();
    onOpen(id);
  }
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
  /**
   * Command-palette selection: the search keeps the keyboard while one visible workspace is
   * the active result. A new query starts at the first match; list or link updates keep the
   * active workspace while it is still shown, else the first; no matches, no active result.
   * The Assistant entry is never part of it.
   */
  let activeId = $state<string | null>(null);
  let searchFocused = $state(false);
  const visibleIds = $derived(visibleWorkspaces.map((item) => String(item.workspace.id)));
  const active = $derived(
    activeId && visibleIds.includes(activeId) ? activeId : (visibleIds[0] ?? null),
  );
  $effect(() => {
    void needle;
    activeId = null;
  });
  const rowDomId = (id: string) => `${rowsId}-row-${id}`;
  // A GitHub login (no nested group path): only these get a github.com avatar request.
  const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
  function moveActive(step: number): void {
    if (!active) return;
    const index = visibleIds.indexOf(active);
    const next = visibleIds[Math.min(visibleIds.length - 1, Math.max(0, index + step))];
    if (!next) return;
    activeId = next;
    void tick().then(() => {
      const button = rows?.querySelector<HTMLElement>(`[data-workspace-id="${CSS.escape(next)}"]`);
      if (button) revealDockItem(button);
    });
  }
  function searchKey(event: KeyboardEvent): void {
    // Composition, and modified keys, keep the field's native editing.
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (event.key === 'Escape' && query) {
      // Clear first; an empty search lets Escape close the dock as usual.
      event.preventDefault();
      event.stopPropagation();
      query = '';
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The active result moves; the keyboard stays in the search.
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      if (!active || pending) return;
      event.preventDefault();
      openRow(active);
    }
  }
  function navigate(event: KeyboardEvent): void {
    // Plain keys only: modified, composing or already-handled keys stay native.
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === searchInput) return;
    const root = event.currentTarget as HTMLElement;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dock-row]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    // Up from the first row returns to the search field.
    if (event.key === 'ArrowUp' && current === 0 && searchInput) {
      searchInput.focus({ preventScroll: true });
      return;
    }
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

{#snippet repoInitial(label: string)}
  <PrincipalAvatar {label} size={32} class="rounded-[9px] type-body font-medium" />
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  class="dock-overview"
  aria-label={m.dock_workspaces_ariaLabel()}
  onkeydown={navigate}
  onfocusin={(event) => revealDockItem(event.target as HTMLElement)}
  onpointerleave={releaseDockIntroHold}
  data-testid="dock-overview"
>
  {#if dockIntro.open}<DockIntroCard />{/if}
  <div class="overview-search type-body" role="search">
    <!-- Always mounted so the zero-result message is announced politely. -->
    <span class="sr-only" role="status" aria-live="polite"
      >{searching && visibleWorkspaces.length === 0
        ? m.dock_overview_search_noMatches_label()
        : ''}</span
    >
    <span class="search-lead" aria-hidden="true"><MagnifyingGlassIcon size={15} /></span>
    <Input
      bind:ref={searchInput}
      bind:value={query}
      id={searchId}
      type="search"
      variant="search"
      data-dock-search
      class="search-input h-full px-0"
      autocomplete="off"
      aria-label={m.dock_overview_search_ariaLabel()}
      placeholder={m.dock_overview_search_placeholder()}
      role="combobox"
      aria-expanded="true"
      aria-haspopup="grid"
      aria-autocomplete="list"
      aria-controls={rowsId}
      aria-activedescendant={active ? rowDomId(active) : undefined}
      onfocus={() => (searchFocused = true)}
      onblur={() => (searchFocused = false)}
      onkeydown={searchKey}
    />
    {#if query}
      <Button
        variant="plain"
        size="icon-compact"
        class="search-clear"
        aria-label={m.dock_overview_searchClear_ariaLabel()}
        onclick={() => {
          query = '';
          searchInput?.focus({ preventScroll: true });
        }}><XIcon size={13} aria-hidden="true" /></Button
      >
    {/if}
  </div>
  <div
    bind:this={rows}
    id={rowsId}
    role="grid"
    aria-label={m.dock_workspaces_ariaLabel()}
    class="overview-rows"
    class:more-below={moreBelow}
    data-dock-scroll
    use:keepDockFocusVisible
    use:trackOverflow={visibleWorkspaces.length +
      Number(!searching && !showOlder && olderWorkspaces.length > 0)}
  >
    {#each visibleWorkspaces as item (item.workspace.id)}
      {@const id = String(item.workspace.id)}
      {@const title = item.workspace.title?.trim() || m.workspace_links_untitled_label()}
      {@const state = resolveWorkspaceStatusState(item.workspace)}
      {@const status = getWorkspaceStatusPresentation(state)}
      {@const repo = workspaceRepositoryLabel(item.workspace)}
      {@const message = item.workspace.statusMessage?.trim() ?? ''}
      <div
        class="overview-row"
        id={rowDomId(id)}
        role="row"
        aria-selected={active === id}
        data-active={searchFocused && active === id}
        onfocusin={() => (activeId = id)}
        data-dock-scroll-item
        data-running={item.isRunning}
      >
        <!-- Grid cells add semantics only (display: contents), not layout. -->
        <div role="gridcell" class="grid-cell">
          <Button
            variant="plain"
            size="sm"
            class="overview-open"
            wrapContent={false}
            disabled={pending}
            data-dock-row
            data-workspace-id={id}
            aria-describedby="dock-status-{id}"
            onclick={() => openRow(id)}
          >
            {@const repository = item.workspace.plainFolder
              ? ''
              : workspaceRepositoryLabel(item.workspace)}
            {@const owner = item.workspace.repositoryOwner?.trim() ?? ''}
            {#if repository}
              <span class="repo-avatar" data-dock-repo-avatar={repository}>
                {#if GITHUB_LOGIN.test(owner)}
                  <!-- The GitHub owner's avatar; the repo initial if it does not load. -->
                  <GitHubAvatar identity={owner} size={32} class="repo-avatar-img">
                    {#snippet fallback()}{@render repoInitial(
                        item.workspace.repositoryName || repository,
                      )}{/snippet}
                  </GitHubAvatar>
                {:else}
                  <!-- No GitHub login (nested group path, local repo): the repo initial. -->
                  {@render repoInitial(item.workspace.repositoryName || repository)}
                {/if}
              </span>
            {:else}
              <DockWorkspaceAvatar {item} variant="emphasized" />
            {/if}
            <span class="row-copy">
              <span class="type-body font-medium truncate" {title}>{title}</span>
              <!-- The repo identifies the row; rows without one keep their status line. -->
              <span class="row-status type-caption" id="dock-status-{id}">
                {#if repo}<span class="row-repo truncate" title={repo} data-dock-row-repo
                    >{repo}</span
                  >{:else}<span
                    class="row-message truncate"
                    title={message || status.label}
                    data-dock-row-message>{message || status.label}</span
                  >{/if}
                <span class="sr-only">{status.accessibleName}</span>
              </span>
            </span>
          </Button>
        </div>
        <div role="gridcell" class="grid-cell">
          <span class="row-time type-caption" title={item.workspace.updatedAt}>
            {item.workspace.updatedAt ? formatCompactRelativeTime(item.workspace.updatedAt) : ''}
          </span>
        </div>
      </div>
    {/each}
    {#if !searching && !showOlder && olderWorkspaces.length > 0}
      <div
        class="overview-history"
        role="row"
        data-dock-scroll-item
        style:height={`${DOCK_OVERVIEW_HISTORY_HEIGHT}px`}
      >
        <div role="gridcell" class="grid-cell">
          <Button
            bind:ref={historyButton}
            variant="plain"
            size="sm"
            class="overview-history-control"
            disabled={pending}
            data-dock-row
            aria-controls={rowsId}
            aria-expanded={showOlder}
            onclick={revealOlder}>{m.dock_overview_showOlder_label()}</Button
          >
        </div>
      </div>
    {/if}
  </div>
  <!-- The Assistant is set apart below the workspaces, always in view. -->
  <div class="assistant-divider" role="presentation"></div>
  <div class="overview-row assistant-row">
    <Button
      bind:ref={assistantButton}
      variant="plain"
      size="sm"
      class="overview-open"
      wrapContent={false}
      disabled={pending}
      data-dock-row
      data-workspace-id="dock:assistant"
      onclick={() => openRow('dock:assistant')}
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
    /* The viewport extends through the frame's right gutter (scrollbar at the dock's edge);
       the rows keep their width and inset. */
    margin-right: calc(-1 * var(--dock-overview-gutter, 0px));
    padding-right: var(--dock-overview-gutter, 0px);
  }
  .overview-history {
    box-sizing: border-box;
    padding-bottom: 12px;
    display: flex;
    flex: none;
  }
  .overview-history :global(.overview-history-control) {
    width: 100%;
    justify-content: flex-start;
    padding-inline: 6px;
    color: hsl(var(--muted-foreground));
  }
  /* Plain search above the rows, no surface (DOCK_OVERVIEW_SEARCH_HEIGHT budgets it). It
     shares a row's leading column (padding, avatar-wide icon cell, gap) so the typed text
     starts where the titles do. */
  .overview-search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 32px;
    margin: 0 0 8px;
    padding: 0 6px;
    color: hsl(var(--muted-foreground));
  }
  .search-lead {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
  }
  .overview-search :global(input.search-input) {
    flex: 1;
    box-shadow: none;
    outline: none;
    font-size: inherit;
    line-height: inherit;
  }
  .overview-search :global(input.search-input::-webkit-search-cancel-button) {
    display: none;
  }
  .overview-search :global(.search-clear) {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    color: inherit;
  }
  .overview-search :global(.search-clear:focus-visible) {
    outline: 1px solid hsl(var(--dock-border, var(--border)));
  }
  .repo-avatar {
    flex: none;
    display: inline-flex;
    width: 32px;
    height: 32px;
  }
  .repo-avatar :global(.repo-avatar-img) {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    object-fit: cover;
  }
  .grid-cell {
    display: contents;
  }
  /* The search's active result, shown only while the search holds the keyboard: the same
     quiet highlight as a keyboard-focused row. */
  .overview-row[data-active='true'] {
    background-color: hsl(var(--dock-hover));
    box-shadow: inset 0 0 0 1px hsl(var(--dock-border));
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
  /* Keyboard focus on a row is the row's own quiet highlight, not the app-wide
     focus box: rows are the dock's list items, and a pointer never shows it. */
  .dock-overview :global(.overview-open:focus-visible) {
    outline: none;
  }
  .overview-row:has(:global(.overview-open:focus-visible)) {
    background-color: hsl(var(--dock-hover));
    box-shadow: inset 0 0 0 1px hsl(var(--dock-border));
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
