<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import AllWorkspacesCard from '../../cards/AllWorkspacesCard.svelte';

  interface Props {
    /** Runs after store init but before AllWorkspacesCard mounts (seed state here). */
    setup?: () => void;
    expanded?: boolean;
    searchVisible?: boolean;
    recentsOnly?: boolean;
    recentLimit?: number;
    searchRecents?: boolean;
    expandableRecents?: boolean;
    excludedWorkspaceIds?: readonly string[];
    showLoadingText?: boolean;
  }

  let {
    setup,
    expanded = false,
    searchVisible = true,
    recentsOnly = false,
    recentLimit,
    searchRecents = false,
    expandableRecents = false,
    excludedWorkspaceIds = [],
    showLoadingText = true,
  }: Props = $props();

  // Store.init() must run during component initialization (it reads Svelte context).
  appStore.init();
  setup?.();
</script>

<AllWorkspacesCard
  {expanded}
  {searchVisible}
  {recentsOnly}
  {recentLimit}
  {searchRecents}
  {expandableRecents}
  {excludedWorkspaceIds}
  {showLoadingText}
/>
