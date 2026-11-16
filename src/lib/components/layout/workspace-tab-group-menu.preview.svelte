<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { WorkspaceTabGroupColor } from '$store/renderer/slices/tab-state/tab-groups';

  interface Props {
    color?: WorkspaceTabGroupColor;
    name?: string;
  }

  export const preview = definePreview<Props>({
    id: 'workspace-tab-group-menu',
    title: 'Tab group color picker',
    defaultState: 'blue',
    states: {
      blue: { props: { color: 'blue' } },
      green: { props: { color: 'green' } },
      purple: { props: { color: 'purple' } },
      orange: { props: { color: 'orange' } },
      pink: { props: { color: 'pink' } },
      grey: { props: { color: 'grey' } },
      lightGreen: { props: { color: 'lightGreen' } },
      turquoise: { props: { color: 'turquoise' } },
      lightBlue: { props: { color: 'lightBlue' } },
      red: { props: { color: 'red' } },
      yellow: { props: { color: 'yellow' } },
      beige: { props: { color: 'beige' } },
      unnamed: { props: { name: '' } },
      'long-name': { props: { name: 'A workspace group with a very long name' } },
    },
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
  import { buildWorkspaceTabGroupMenu } from './workspace-tab-group-actions';
  import WorkspaceTabGroupChip from './WorkspaceTabGroupChip.svelte';

  let { color = 'blue', name = 'Intent' }: Props = $props();
  let group: WorkspaceTabGroup = $state(
    untrack(() => ({ id: 'preview', name, color, workspaceIds: ['app', 'api', 'docs'] })),
  );
  let root: HTMLDivElement;
  let menu: SidebarContextPosition | null = $state(null);
  let open = $state(true);
  let editing = $state(false);
  let visible = $state(true);
  const items = $derived(
    buildWorkspaceTabGroupMenu({
      group,
      onRename: () => (editing = true),
      onSetColor: (next) => (group.color = next),
      onUngroup: () => (visible = false),
      onCloseGroup: () => (visible = false),
      groupByProject: { run: () => {} },
    }),
  );

  onMount(() => {
    const trigger = root.querySelector<HTMLElement>('[data-workspace-tab-group-trigger]');
    const bounds = trigger?.getBoundingClientRect();
    if (bounds) menu = { x: bounds.left, y: bounds.bottom + 8, returnFocus: trigger };
  });
</script>

<div bind:this={root} class="flex h-72 items-start p-3" data-color-picker-preview>
  {#if visible}
    <WorkspaceTabGroupChip
      {group}
      {open}
      {editing}
      onToggle={() => (open = !open)}
      onContextMenu={(event) => {
        const position = getSidebarContextPosition(event);
        if (position) menu = position;
      }}
      onRenameEnd={(next) => {
        if (next !== null) group.name = next;
        editing = false;
      }}
    />
  {/if}
  {#if menu}
    <SidebarContextMenu {...menu} {items} onClickOutside={() => (menu = null)} />
  {/if}
</div>
