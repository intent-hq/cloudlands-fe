<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import AllWorkspacesCard from '../../cards/AllWorkspacesCard.svelte';

  interface Props {
    /** Runs after store init but before AllWorkspacesCard mounts (seed state here). */
    setup?: () => void;
    expanded?: boolean;
  }

  let { setup, expanded = false }: Props = $props();

  // Store.init() must run during component initialization (it reads Svelte context).
  appStore.init();
  setup?.();
</script>

<AllWorkspacesCard {expanded} />

