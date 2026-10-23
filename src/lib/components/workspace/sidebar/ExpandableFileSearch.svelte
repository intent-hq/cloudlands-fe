<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import SidebarExpandableSearch from './SidebarExpandableSearch.svelte';

  interface Props {
    query?: string;
    onKeydown?: (event: KeyboardEvent) => void;
    active?: boolean;
  }

  let { query = $bindable(''), onKeydown, active = true }: Props = $props();
</script>

<SidebarExpandableSearch
  bind:query
  scope="files"
  placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
  {onKeydown}
  {active}
/>
