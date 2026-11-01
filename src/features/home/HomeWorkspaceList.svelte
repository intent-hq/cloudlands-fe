<script lang="ts">
  import WorkspaceMicroKeySlot from '$features/hardware-console/components/WorkspaceMicroKeySlot.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { ListRow, ListView, SectionedList } from '$lib/components/patterns/collection';
  import SidebarOverflowMenu from '$lib/components/ui/sidebar-context-menu/SidebarOverflowMenu.svelte';
  import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import {
    faArrowDown,
    faArrowUp,
    faChevronDown,
    faChevronRight,
    faFolder,
    faThumbtack,
  } from '@fortawesome/free-solid-svg-icons';
  import { tick, untrack } from 'svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeWorkspacePurgedBadge from './HomeWorkspacePurgedBadge.svelte';
  import HomeWorkspaceRepositoryLabel from './HomeWorkspaceRepositoryLabel.svelte';
  import { isPlainFolderWorkspace } from '$lib/utils/plain-folder-workspace';
  import { HOME_SET_ASIDE_GROUP } from './home-set-aside';

  interface HomeListSection {
    id: string;
    label: string;
    items: Workspace[];
    expanded: boolean;
  }

  let {
    workspaces,
    groups,
    aside,
    asideExpanded,
    pinnedIds,
    selectedId,
    showRepository,
    showRepositoryOwner,
    menu,
    onopen,
    onmenu,
    onselect,
    ongroupexpanded,
    onasideexpanded,
    ontoggleaside,
  }: {
    /** Active rows in display order (set-aside rows excluded). */
    workspaces: Workspace[];
    groups: HomeListSection[];
    /** Set-aside rows in the current scope, shown in a collapsible shelf. */
    aside: Workspace[];
    asideExpanded: boolean;
    pinnedIds: readonly string[];
    selectedId: string | null;
    showRepository: boolean;
    showRepositoryOwner: boolean;
    menu: (workspace: Workspace) => SidebarMenuEntry[];
    /** Click or keyboard activation; opens only for modified events. */
    onopen: (event: MouseEvent | KeyboardEvent, id: string) => void;
    /** Context menu request; `option` anchors the keyboard (ContextMenu, Shift+F10) case. */
    onmenu: (event: MouseEvent | KeyboardEvent, workspace: Workspace, option?: HTMLElement) => void;
    onselect: (id: string | null) => void;
    ongroupexpanded: (group: string, expanded: boolean, items: Workspace[]) => void;
    onasideexpanded: (expanded: boolean) => void;
    ontoggleaside: (workspace: Workspace) => void;
  } = $props();

  const asideIds = $derived(new Set(aside.map((workspace) => workspace.id)));
  function isLive(workspace: Workspace): boolean {
    return (
      workspace.status !== WorkspaceStatusEnum.Archived &&
      workspace.status !== WorkspaceStatusEnum.Retired
    );
  }
  function optionWorkspaceId(event: KeyboardEvent): { option: HTMLElement | null; id?: string } {
    const option =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[role="option"]')
        : null;
    return {
      option,
      id: option?.querySelector<HTMLElement>('[data-home-workspace]')?.dataset.homeWorkspace,
    };
  }

  // The first set-aside row swaps the flat virtualized list for the shelf layout, which
  // owns a different scroller; carry the reading position across the swap.
  const shelfLayout = $derived(groups.length > 0 || aside.length > 0);
  let root = $state<HTMLElement | null>(null);
  const scroller = () => root?.querySelector<HTMLElement>('.overflow-y-auto') ?? null;
  let previousShelfLayout = untrack(() => shelfLayout);
  $effect.pre(() => {
    const next = shelfLayout;
    untrack(() => {
      if (next === previousShelfLayout) return;
      previousShelfLayout = next;
      const top = scroller()?.scrollTop ?? 0;
      void tick().then(() => {
        const element = scroller();
        if (element) element.scrollTop = top;
      });
    });
  });
</script>

{#snippet asideAction(item: Workspace)}
  {@const setAside = asideIds.has(item.id)}
  {@const label = setAside ? m.home_setAside_bringBack_label() : m.home_setAside_action_label()}
  <span class="home-aside-control"
    ><Button
      variant="plain"
      size="icon-compact"
      iconOnly
      type="button"
      class="home-aside-action"
      aria-label={label}
      tooltip={label}
      data-home-set-aside-action={item.id}
      onclick={(event) => {
        event.stopPropagation();
        ontoggleaside(item);
      }}
      oncontextmenu={(event) => event.stopPropagation()}
      ><Fa icon={setAside ? faArrowUp : faArrowDown} class="size-3.5" /></Button
    ></span
  >
{/snippet}

{#snippet workspaceRow({ item }: { item: Workspace })}
  {@const displayTitle = item.title.trim() ? item.title : m.workspace_links_untitled_label()}
  {@const pullRequestCount = isPlainFolderWorkspace(item)
    ? 0
    : (item.pullRequestsTotal ?? item.pullRequests?.length ?? 0)}
  <ListRow
    class="home-list-row h-12 items-center border-b border-border px-3 py-1"
    data-home-workspace={item.id}
    onclick={(event) => onopen(event, item.id)}
    oncontextmenu={(event) => onmenu(event, item)}
  >
    {#snippet leading()}
      <span class="flex items-center gap-2">
        <WorkspaceMicroKeySlot workspaceId={item.id} />
        {#if showRepository && item.repositoryOwner}
          <Tooltip.Provider
            ><Tooltip.Root
              ><Tooltip.Trigger
                >{#snippet child({ props: homeTooltipProps })}<span {...homeTooltipProps}>
                    <GitHubAvatar
                      identity={item.repositoryOwner ?? ''}
                      size={20}
                      class="shrink-0 rounded-sm"
                    />
                  </span>{/snippet}</Tooltip.Trigger
              ><Tooltip.Content
                >{[item.repositoryOwner, item.repositoryName]
                  .filter(Boolean)
                  .join('/')}</Tooltip.Content
              ></Tooltip.Root
            ></Tooltip.Provider
          >
        {:else if showRepository && (item.repositoryPath || item.repositoryName)}
          <Tooltip.Provider
            ><Tooltip.Root
              ><Tooltip.Trigger
                >{#snippet child({ props: homeTooltipProps })}<span
                    {...homeTooltipProps}
                    class="flex size-5 items-center justify-center text-muted-foreground"
                    ><Fa icon={faFolder} /></span
                  >{/snippet}</Tooltip.Trigger
              ><Tooltip.Content>{item.repositoryName || item.repositoryPath}</Tooltip.Content
              ></Tooltip.Root
            ></Tooltip.Provider
          >
        {/if}
      </span>
    {/snippet}
    {#snippet title()}
      <span class="home-row-line">
        <Tooltip.Provider
          ><Tooltip.Root
            ><Tooltip.Trigger
              >{#snippet child({ props: homeTooltipProps })}<span
                  {...homeTooltipProps}
                  class="home-row-title truncate font-medium">{displayTitle}</span
                >{/snippet}</Tooltip.Trigger
            ><Tooltip.Content>{displayTitle}</Tooltip.Content></Tooltip.Root
          ></Tooltip.Provider
        >
        <span class="home-row-description flex min-w-0 items-center gap-2">
          <HomeWorkspacePullBadge workspace={item} />
          {#if pullRequestCount > 1}
            <span
              class="shrink-0 rounded-full border border-border px-2 py-0.5 type-caption tabular-nums"
              >+{formatInteger(pullRequestCount - 1)}</span
            >
          {/if}
          <Tooltip.Provider
            ><Tooltip.Root
              ><Tooltip.Trigger
                >{#snippet child({ props: homeTooltipProps })}<span
                    {...homeTooltipProps}
                    class="home-workspace-summary min-w-0 truncate type-caption"
                    >{item.statusMessage || ''}</span
                  >{/snippet}</Tooltip.Trigger
              ><Tooltip.Content>{item.statusMessage || ''}</Tooltip.Content></Tooltip.Root
            ></Tooltip.Provider
          >
        </span>
        {#if showRepository}
          <HomeWorkspaceRepositoryLabel workspace={item} showOwner={showRepositoryOwner} />
        {/if}
      </span>
    {/snippet}
    {#snippet trailing()}<span
        class="workspace-row-meta flex shrink-0 items-center gap-2 text-muted-foreground"
      >
        {#if pinnedIds.includes(item.id)}<Tooltip.Provider
            ><Tooltip.Root
              ><Tooltip.Trigger
                >{#snippet child({ props: homeTooltipProps })}<span
                    {...homeTooltipProps}
                    aria-label={m.layout_activeCard_pinned_header()}><Fa icon={faThumbtack} /></span
                  >{/snippet}</Tooltip.Trigger
              ><Tooltip.Content>{m.layout_activeCard_pinned_header()}</Tooltip.Content
              ></Tooltip.Root
            ></Tooltip.Provider
          >{/if}
        <HomeWorkspacePurgedBadge workspace={item} />
        <HomeWorkspaceStatus workspace={item} />
        <span class="home-aside-slot shrink-0">
          <span
            class="inline-flex min-w-6 shrink-0 justify-end whitespace-nowrap type-caption tabular-nums"
            data-home-row-time
          >
            <HomeActivityTime workspace={item} />
          </span>
          {#if isLive(item)}
            {@render asideAction(item)}
          {/if}
        </span>
        <SidebarOverflowMenu
          items={menu(item)}
          ariaLabel={m.workspace_sidebarHeader_actions_ariaLabel()}
        />
      </span>{/snippet}
  </ListRow>
{/snippet}

{#snippet workspaceList(items: Workspace[], label: string, scroll: boolean)}
  <ListView
    onkeydowncapture={(event) => {
      const { id } = optionWorkspaceId(event);
      if (id) onopen(event, id);
    }}
    onkeydown={(event) => {
      const { option, id } = optionWorkspaceId(event);
      const workspace = items.find((item) => item.id === id);
      if (workspace) onmenu(event, workspace, option ?? undefined);
    }}
    {items}
    rowHeight={48}
    virtualize={scroll ? 'auto' : false}
    getKey={(workspace) => workspace.id}
    getText={(workspace) =>
      workspace.title.trim() ? workspace.title : m.workspace_links_untitled_label()}
    selectable="single"
    selectedKeys={selectedId ? [selectedId] : []}
    onSelectedKeysChange={(keys) => onselect(keys[0] ? String(keys[0]) : null)}
    ariaLabel={label}
    class={scroll ? 'min-h-0 flex-1 overflow-y-auto px-5 pb-4' : 'overflow-visible'}
    row={workspaceRow}
  />
{/snippet}

{#snippet groupHeader(
  id: string,
  label: string,
  expanded: boolean,
  toggle: () => void,
  count?: number,
)}
  <h3 class="home-group-header flex min-h-8 items-center gap-2 px-2" data-home-group={id}>
    <Button
      variant="plain"
      size="sm"
      class="w-full justify-start gap-1.5 px-2"
      labelClass="flex-initial"
      data-home-set-aside-toggle={id === HOME_SET_ASIDE_GROUP ? '' : undefined}
      aria-expanded={expanded}
      aria-label={label}
      onclick={toggle}
    >
      <span
        class="text-left font-medium {id === HOME_SET_ASIDE_GROUP
          ? 'text-muted-foreground'
          : 'text-foreground'}">{label}</span
      >
      {#if count !== undefined && !expanded}<span
          class="font-normal tabular-nums text-muted-foreground">{formatInteger(count)}</span
        >{/if}
      {#snippet trailingIcon()}<Fa
          icon={expanded ? faChevronDown : faChevronRight}
          class="size-3 text-muted-foreground"
        />{/snippet}
    </Button>
  </h3>
{/snippet}

<div class="contents" bind:this={root}>
  {#if shelfLayout}
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
      {#if groups.length > 0}<SectionedList
          sections={groups}
          getKey={(group) => group.id}
          inset={false}
        >
          {#snippet header(group)}
            {@render groupHeader(group.id, group.label, group.expanded, () =>
              ongroupexpanded(group.id, !group.expanded, group.items),
            )}
          {/snippet}
          {#snippet children(group)}
            {#if group.expanded}
              {@render workspaceList(group.items, group.label, false)}
            {/if}
          {/snippet}
        </SectionedList>
      {:else if workspaces.length > 0}
        {@render workspaceList(workspaces, m.home_tab_workspaces(), false)}
      {/if}
      {#if aside.length > 0}
        <section
          class={workspaces.length ? 'pt-3' : ''}
          data-home-set-aside
          aria-label={m.home_setAside_action_label()}
        >
          {@render groupHeader(
            HOME_SET_ASIDE_GROUP,
            m.home_setAside_action_label(),
            asideExpanded,
            () => onasideexpanded(!asideExpanded),
            aside.length,
          )}
          {#if asideExpanded}
            {@render workspaceList(aside, m.home_setAside_action_label(), false)}
          {/if}
        </section>
      {/if}
    </div>
  {:else}
    {@render workspaceList(workspaces, m.home_tab_workspaces(), true)}
  {/if}
</div>
