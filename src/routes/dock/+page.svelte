<script lang="ts">
  import { onMount } from 'svelte';
  import DockRail from '$features/hud/components/DockRail.svelte';
  import { startHudSubscription } from '$features/hud';
  import { selectDockWorkspaces } from '$store/renderer/slices/hud/hud-selectors';

  const dockWorkspaces$ = selectDockWorkspaces();

  onMount(() => startHudSubscription());
</script>

<DockRail workspaces={$dockWorkspaces$} />
