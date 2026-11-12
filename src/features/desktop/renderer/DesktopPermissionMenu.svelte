<script lang="ts">
  import { faDesktop } from '@fortawesome/free-solid-svg-icons';
  import { untrack } from 'svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';
  import { selectDesktopEntry } from '$store/renderer/slices/desktop-control/desktop-control-selectors';
  import {
    desktopPermissionRequested,
    desktopReadRequested,
  } from '$store/renderer/slices/desktop-control/desktop-control-slice';
  import { store } from '$store/renderer/store';
  let {
    workspaceId,
    agentId,
    separator = true,
  }: { workspaceId: string; agentId: string; separator?: boolean } = $props();
  const entry = selectDesktopEntry(
    untrack(() => workspaceId),
    untrack(() => agentId),
  );
  $effect(() => {
    store.dispatch(desktopReadRequested(workspaceId, agentId));
  });
</script>

{#if $entry?.permission}
  {#if separator}
    <Menu.Separator />
  {/if}
  <Menu.CheckboxItem
    indicator="switch"
    icon={faDesktop}
    checked={$entry.permission.allowed}
    onSelect={(event) => {
      // The switch follows the confirmed permission; reads and saves never disable the row.
      event.preventDefault();
      const permission = $entry?.permission;
      if (permission && !$entry?.saving)
        store.dispatch(
          desktopPermissionRequested(
            workspaceId,
            agentId,
            permission.computerId,
            !permission.allowed,
          ),
        );
    }}
  >
    {m.settings_agentFeatures_desktopControl_label()}
  </Menu.CheckboxItem>
{/if}
