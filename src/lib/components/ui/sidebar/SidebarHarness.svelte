<script lang="ts">
  import * as Sidebar from './index';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let menuSelections = $state(0);
</script>

<Sidebar.Provider
  bind:open
  class="relative h-72 !min-h-0 overflow-hidden rounded-md border border-border"
>
  <Sidebar.Trigger />
  <Sidebar.Root collapsible="icon" class="!absolute !inset-y-0 !h-full">
    <Sidebar.Header><span class="type-title">Workspace</span></Sidebar.Header>
    <Sidebar.Content>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton
                aria-label="Overview"
                isActive
                tooltipContent="Overview"
                onclick={() => (menuSelections += 1)}
              >
                <span>Overview</span>
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton aria-label="Disabled navigation" disabled>
                <span>Disabled navigation</span>
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </Sidebar.Content>
  </Sidebar.Root>
  <output aria-label="Sidebar open state">{open}</output>
  <output aria-label="Sidebar menu selections">{menuSelections}</output>
</Sidebar.Provider>
