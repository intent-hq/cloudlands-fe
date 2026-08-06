<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import SidebarNavHoverCard from '../../SidebarNavHoverCard.svelte';

  interface Props {
    /** Runs after store init but before the hover card mounts (seed state here). */
    setup?: () => void;
  }

  let { setup }: Props = $props();

  // Store.init() must run during component initialization (it reads Svelte context).
  appStore.init();
  setup?.();
</script>

<!-- Stand-in nav rail: outside-click dismissal must ignore clicks landing here -->
<nav class="sidebar-nav">
  <button data-testid="nav-button" aria-label="nav"></button>
</nav>

<!-- Element outside both the card and the nav rail -->
<button data-testid="outside-button" aria-label="outside"></button>

<SidebarNavHoverCard iconRefs={{}} />
