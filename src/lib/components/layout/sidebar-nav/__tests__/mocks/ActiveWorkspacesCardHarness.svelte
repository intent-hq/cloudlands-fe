<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import ActiveWorkspacesCard from '../../cards/ActiveWorkspacesCard.svelte';

  interface Props {
    /** Runs after store init but before ActiveWorkspacesCard mounts (seed state here). */
    setup?: () => void;
    expanded?: boolean;
  }

  let { setup, expanded = false }: Props = $props();

  // Store.init() must run during component initialization (it reads Svelte context).
  appStore.init();
  setup?.();
</script>

<ActiveWorkspacesCard {expanded} />
