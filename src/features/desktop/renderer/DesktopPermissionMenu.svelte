<script lang="ts">
  import { untrack } from 'svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';
  import { selectDesktopEntry } from '$store/renderer/slices/desktop-control/desktop-control-selectors';
  import {
    desktopPermissionRequested,
    desktopReadRequested,
  } from '$store/renderer/slices/desktop-control/desktop-control-slice';
  import { store } from '$store/renderer/store';
  let { workspaceId, agentId }: { workspaceId: string; agentId: string } = $props();
  const entry = selectDesktopEntry(
    untrack(() => workspaceId),
    untrack(() => agentId),
  );
  $effect(() => {
    store.dispatch(desktopReadRequested(workspaceId, agentId));
  });
</script>

{#if $entry?.permission}
  <Menu.Separator />
  <Menu.CheckboxItem
    checked={$entry.permission.allowed}
    disabled={$entry.saving || $entry.loading}
    onCheckedChange={(allowed) => {
      if ($entry?.permission)
        store.dispatch(
          desktopPermissionRequested(workspaceId, agentId, $entry.permission.computerId, allowed),
        );
    }}
  >
    {m.desktop_menu_label()}
  </Menu.CheckboxItem>
  <p class="px-2 py-1 text-xs text-muted-foreground break-words">
    {m.desktop_menu_description({ computer: $entry.permission.computerName })}
  </p>
{/if}
