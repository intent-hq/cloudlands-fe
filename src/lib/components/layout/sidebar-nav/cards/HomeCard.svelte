<script lang="ts">
  /**
   * HomeCard - Hover card content for the Home nav item
   * Navigates to the home page on click.
   */
  import { goto } from '$app/navigation';

  import { closeAll } from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$lib/store/store';

</script>

<button
  class="w-full text-left px-3 py-2 hover:bg-muted/30 transition-colors cursor-pointer text-xs text-muted-foreground hover:text-foreground"
  onclick={() => {
    appStore.dispatch(closeAll(false));
    goto('/');
  }}
>
  Go to Home →
</button>
