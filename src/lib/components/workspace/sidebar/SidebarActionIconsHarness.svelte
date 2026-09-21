<script lang="ts">
  import SidebarHeaderAction from './SidebarHeaderAction.svelte';
  import { m } from '$shared/paraglide/messages.js';
</script>

<div class="grid w-full max-w-sm gap-4">
  {#each ['Context', 'Changes', 'Files'] as title}
    <!-- i18n-ignore (catalog fixture heading) -->
    <div class="flex items-center justify-between rounded-lg bg-sidebar p-3">
      <span class="type-body font-medium">{title}</span>
      <div class="flex items-center gap-1">
        {#if title === 'Context' || title === 'Files'}
          <SidebarHeaderAction
            icon="search"
            label={m.workspace_multiSelectSidebar_searchContext_placeholder()}
          />
        {/if}
        {#if title === 'Context'}
          <SidebarHeaderAction icon="plus" label={m.menu_new_note()} />
        {/if}
        <SidebarHeaderAction icon="close" label={m.ui_tab_close_ariaLabel()} />
      </div>
    </div>
  {/each}
</div>
