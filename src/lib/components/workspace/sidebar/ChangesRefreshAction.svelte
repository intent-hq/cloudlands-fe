<script lang="ts">
  import SidebarHeaderAction from './SidebarHeaderAction.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { disabled, onclick }: { disabled: boolean; onclick: () => void } = $props();
</script>

<SidebarHeaderAction
  icon="refresh"
  {onclick}
  {disabled}
  busy={disabled}
  label={m.workspace_sidebarChanges_refreshGitStatus_tooltip()}
  data-changes-refresh
/>
