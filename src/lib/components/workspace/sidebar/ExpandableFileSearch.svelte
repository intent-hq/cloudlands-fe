<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import SidebarExpandableSearch from './SidebarExpandableSearch.svelte';

  interface Props {
    query?: string;
    onKeydown?: (event: KeyboardEvent) => void;
  }

  let { query = $bindable(''), onKeydown }: Props = $props();
</script>

<SidebarExpandableSearch
  bind:query
  scope="files"
  placement="toolbar"
  placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
  {onKeydown}
/>
