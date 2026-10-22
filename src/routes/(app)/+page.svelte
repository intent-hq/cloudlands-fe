<script lang="ts">
  import HomePage from '$features/home/HomePage.svelte';
  import { m } from '$shared/paraglide/messages.js';
</script>

<svelte:head><title>{m.home_page_title()}</title></svelte:head>
<HomePage />
