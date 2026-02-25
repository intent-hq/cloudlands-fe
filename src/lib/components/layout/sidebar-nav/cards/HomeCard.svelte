<script lang="ts">
  /**
   * HomeCard - Hover card content for the Home nav item
   * Navigates to the home page on click.
   */
  import { goto } from '$app/navigation';
  import { sidebarNavStore } from '../sidebar-nav.store.svelte';
</script>

<button
  class="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer text-xs text-muted-foreground hover:text-foreground"
  onclick={() => {
    sidebarNavStore.closeAll();
    goto('/');
  }}
>
  Go to Home →
</button>
