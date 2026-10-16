<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { SectionedList } from '$lib/components/patterns/collection';
  import { store } from '$store/renderer/store';
  import { setDashboardVisibleWorkspaces } from '$store/renderer/slices/dashboard-details/dashboard-details-slice';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import Fa from 'svelte-fa';
  import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import HomeWorkspaceDashboardCard from './HomeWorkspaceDashboardCard.svelte';

  let {
    workspaces,
    groups,
    selectedId,
    showRepository = true,
    onselect,
    onopen,
    oncontextmenu,
    onexpand,
  }: {
    workspaces: Workspace[];
    groups: { id: string; label: string; items: Workspace[]; expanded: boolean }[];
    selectedId: string | null;
    showRepository?: boolean;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
    oncontextmenu: (event: MouseEvent | KeyboardEvent, workspace: Workspace) => void;
    onexpand: (id: string, expanded: boolean, items: Workspace[]) => void;
  } = $props();
  let dashboard = $state<HTMLDivElement>();
  const ownerId = crypto.randomUUID();
  const cardIds = new Map<Element, string>();
  const visible = new Set<Element>();
  let observer: IntersectionObserver | undefined;
  let stopped = false;

  function reportVisible() {
    if (stopped) return;
    store.dispatch(
      setDashboardVisibleWorkspaces(
        ownerId,
        [...visible].flatMap((node) => {
          const id = cardIds.get(node);
          return id ? [id] : [];
        }),
      ),
    );
  }

  function observeCard(node: HTMLElement, id: string) {
    cardIds.set(node, id);
    observer?.observe(node);
    return {
      destroy() {
        observer?.unobserve(node);
        cardIds.delete(node);
        if (visible.delete(node)) reportVisible();
      },
    };
  }

  $effect(() => {
    if (!dashboard) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        reportVisible();
      },
      { root: dashboard, rootMargin: '200px 0px' },
    );
    for (const node of cardIds.keys()) observer.observe(node);
    return () => {
      observer?.disconnect();
      observer = undefined;
      visible.clear();
    };
  });
  onDestroy(() => {
    stopped = true;
    observer?.disconnect();
    visible.clear();
    store.dispatch(setDashboardVisibleWorkspaces(ownerId, []));
  });

  $effect.pre(() => {
    void groups;
    void workspaces;
    const focused = dashboard?.ownerDocument.activeElement;
    if (!(focused instanceof HTMLElement) || !dashboard?.contains(focused)) return;
    const id = focused.dataset.homeWorkspace;
    if (!id) return;
    void tick().then(() => {
      if (focused.isConnected || document.activeElement !== document.body) return;
      dashboard
        ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true });
    });
  });
</script>

{#snippet cards(items: Workspace[], repositoryVisible = showRepository)}
  <div class="home-dashboard-grid grid min-w-0 gap-4 pb-5">
    {#each items as workspace (workspace.id)}
      <div class="min-w-0" use:observeCard={workspace.id}>
        <HomeWorkspaceDashboardCard
          {workspace}
          selected={selectedId === workspace.id}
          showRepository={repositoryVisible}
          {onselect}
          {onopen}
          {oncontextmenu}
        />
      </div>
    {/each}
  </div>
{/snippet}

<div
  bind:this={dashboard}
  class="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-1"
  data-home-dashboard
  aria-label={m.home_dashboard_view_label()}
>
  {#if groups.length}
    <SectionedList sections={groups} getKey={(group) => group.id} inset={false}>
      {#snippet header(group)}
        <h3 data-home-group={group.id} class="flex min-h-8 items-center">
          <Button
            variant="plain"
            size="sm"
            class="w-full justify-start gap-1.5 px-2"
            labelClass="flex-initial"
            aria-expanded={group.expanded}
            aria-label={group.label}
            onclick={() => onexpand(group.id, !group.expanded, group.items)}
          >
            <span class="text-left font-medium text-foreground">{group.label}</span>
            {#snippet trailingIcon()}<Fa
                icon={group.expanded ? faChevronDown : faChevronRight}
                class="size-3 text-muted-foreground"
              />{/snippet}
          </Button>
        </h3>
      {/snippet}
      {#snippet children(group)}
        {#if group.expanded}{@render cards(
            group.items,
            showRepository || group.id === 'pinned',
          )}{/if}
      {/snippet}
    </SectionedList>
  {:else}
    {@render cards(workspaces)}
  {/if}
</div>

<style>
  .home-dashboard-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  }
</style>
