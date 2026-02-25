<script lang="ts">
  /**
   * SettingsCard - Hover card content for the Settings nav item
   * Navigates to the settings page on click.
   */
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { sidebarNavStore } from '../sidebar-nav.store.svelte';
</script>

<button
  class="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer text-xs text-muted-foreground hover:text-foreground"
  onclick={() => {
    sidebarNavStore.closeAll();
    navigateToSettings();
  }}
>
  Go to Settings →
</button>
