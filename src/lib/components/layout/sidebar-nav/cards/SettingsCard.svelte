<script lang="ts">
  /**
   * SettingsCard - Hover card content for the Settings nav item
   * Navigates to the settings page on click.
   */
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { closeAll } from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';

  const dispatch = getDispatch();
</script>

<button
  class="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer text-xs text-muted-foreground hover:text-foreground"
  onclick={() => {
    dispatch(closeAll(false));
    navigateToSettings();
  }}
>
  Go to Settings →
</button>
