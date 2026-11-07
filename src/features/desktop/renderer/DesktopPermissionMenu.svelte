<script lang="ts">
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
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
    checked={$entry.permission.allowed}
    disabled={$entry.saving || $entry.loading}
    onCheckedChange={(allowed) => {
      if ($entry?.permission)
        store.dispatch(
          desktopPermissionRequested(workspaceId, agentId, $entry.permission.computerId, allowed),
        );
    }}
  >
    {#snippet leading()}
      <Fa icon={faDesktop} weight="regular" class="size-(--menu-icon-size) text-muted-foreground" />
    {/snippet}
    {m.settings_agentFeatures_desktopControl_label()}
  </Menu.CheckboxItem>
{/if}
