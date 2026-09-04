<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import * as Sidebar from './index';

  let {
    open = $bindable(false),
    peek = 'none',
    variant = 'sidebar',
    rail = true,
    side = 'left',
    fixtureState = 'default',
  }: {
    open?: boolean;
    peek?: 'none' | 'hover' | 'click';
    variant?: 'sidebar' | 'floating' | 'inset';
    rail?: boolean;
    side?: 'left' | 'right';
    fixtureState?:
      | 'default'
      | 'floating'
      | 'inset'
      | 'nested'
      | 'actions-and-badges'
      | 'header-footer-stacking'
      | 'callouts'
      | 'status-dots'
      | 'skeleton'
      | 'compact'
      | 'collapsed'
      | 'peek-hover'
      | 'resizing';
  } = $props();
  let menuSelections = $state(0);
</script>

<Sidebar.Provider
  bind:open
  {peek}
  persist={false}
  data-force-actions={fixtureState === 'actions-and-badges'}
  data-sidebar-fixture-state={fixtureState}
  class="relative h-72 !min-h-0 overflow-hidden rounded-md border border-border"
>
  <Sidebar.Root
    collapsible="offcanvas"
    {variant}
    {rail}
    {side}
    class="!absolute !inset-y-0 !h-full"
  >
    <Sidebar.Header
      orientation={fixtureState === 'header-footer-stacking' ? 'horizontal' : 'vertical'}
    >
      <span class="type-title min-w-0 flex-1 truncate">Workspace</span>
      {#if fixtureState === 'header-footer-stacking'}
        <Sidebar.Trigger />
      {/if}
    </Sidebar.Header>
    <Sidebar.Content>
      {#if fixtureState === 'callouts'}
        <div class="flex flex-col gap-2 p-2">
          <Sidebar.Callout>
            <strong class="type-body">New workspace tools</strong>
            <span class="type-caption text-muted-foreground">Explore the updated navigation.</span>
          </Sidebar.Callout>
          <Sidebar.Callout variant="inline">
            <span class="type-caption">Three updates available</span>
          </Sidebar.Callout>
        </div>
      {/if}
      <Sidebar.Group collapsible open>
        <Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
        {#if fixtureState === 'actions-and-badges'}
          <Sidebar.GroupActions>
            <Sidebar.GroupAction aria-label="Add navigation item"
              ><span>+</span></Sidebar.GroupAction
            >
            <Sidebar.GroupAction aria-label="Navigation options"><span>⋯</span></Sidebar.GroupAction
            >
          </Sidebar.GroupActions>
        {/if}
        <Sidebar.GroupContent>
          <Sidebar.Menu size={fixtureState === 'compact' ? 'compact' : undefined}>
            {#if fixtureState === 'skeleton'}
              {#each [0, 1, 2, 3] as widthIndex}
                <Sidebar.MenuSkeleton showIcon {widthIndex} />
              {/each}
            {:else}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  aria-label="Overview"
                  label="Overview"
                  isActive={fixtureState !== 'nested' && fixtureState !== 'status-dots'}
                  status={fixtureState === 'status-dots' ? 'active' : undefined}
                  tooltipContent="Overview"
                  onclick={() => (menuSelections += 1)}
                />
                {#if fixtureState === 'actions-and-badges'}
                  <Sidebar.MenuAction showOnHover aria-label="Overview actions">
                    <span aria-hidden="true">⋯</span>
                  </Sidebar.MenuAction>
                {/if}
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  aria-label={fixtureState === 'status-dots' ? undefined : 'Projects navigation'}
                  label="Projects"
                  isActive={fixtureState === 'nested'}
                  status={fixtureState === 'status-dots' ? 'unread' : undefined}
                />
                {#if fixtureState === 'nested'}
                  <Sidebar.MenuSub>
                    <Sidebar.MenuSubItem>
                      <Sidebar.MenuSubButton label="Roadmap" aria-label="Roadmap navigation" />
                    </Sidebar.MenuSubItem>
                    <Sidebar.MenuSubItem>
                      <Sidebar.MenuSubButton
                        label="Design"
                        aria-label="Design navigation"
                        isActive
                      />
                      <Sidebar.MenuSub>
                        <Sidebar.MenuSubItem>
                          <Sidebar.MenuSubButton
                            label="Components"
                            aria-label="Components navigation"
                            isActive
                          />
                        </Sidebar.MenuSubItem>
                        <Sidebar.MenuSubItem>
                          <Sidebar.MenuSubButton label="Tokens" aria-label="Tokens navigation" />
                        </Sidebar.MenuSubItem>
                      </Sidebar.MenuSub>
                    </Sidebar.MenuSubItem>
                  </Sidebar.MenuSub>
                {/if}
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  aria-label="Settings navigation"
                  label="Settings"
                  status={fixtureState === 'status-dots'
                    ? 'idle'
                    : fixtureState === 'actions-and-badges'
                      ? 'unread'
                      : undefined}
                />
                {#if fixtureState === 'actions-and-badges'}
                  <Sidebar.MenuBadge>3</Sidebar.MenuBadge>
                  <Sidebar.MenuActions showOnHover>
                    <Sidebar.MenuAction aria-label="Pin settings"><span>+</span></Sidebar.MenuAction
                    >
                    <Sidebar.MenuAction aria-label="Settings options"
                      ><span>⋯</span></Sidebar.MenuAction
                    >
                  </Sidebar.MenuActions>
                {/if}
              </Sidebar.MenuItem>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  aria-label="Disabled navigation"
                  label="Disabled navigation"
                  disabled
                />
              </Sidebar.MenuItem>
            {/if}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </Sidebar.Content>
    {#if fixtureState === 'header-footer-stacking'}
      <Sidebar.Footer orientation="horizontal">
        <span class="type-caption min-w-0 flex-1 truncate text-muted-foreground">Signed in</span>
        <Sidebar.Trigger />
      </Sidebar.Footer>
    {/if}
  </Sidebar.Root>
  <Sidebar.Inset class="min-w-0 overflow-hidden p-6 pt-12">
    <Sidebar.Trigger class="absolute right-3 top-3" />
    <div class="max-w-md space-y-2">
      <h2 class="type-title">{m.workspace_multiSelectSidebar_overviewTab_label()}</h2>
      <p class="type-body text-muted-foreground">
        {m.workspace_multiSelectSidebar_overviewTab_description()}
      </p>
      <p class="type-body text-muted-foreground">
        {m.workspace_multiSelectSidebar_contextTab_description()}
      </p>
    </div>
  </Sidebar.Inset>
  <output class="sr-only" aria-label="Sidebar open state">{open}</output>
  <output class="sr-only" aria-label="Sidebar menu selections">{menuSelections}</output>
</Sidebar.Provider>
