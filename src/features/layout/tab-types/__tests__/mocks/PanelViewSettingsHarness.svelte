<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import AgentViewSettingsDropdown from '../../AgentViewSettingsDropdown.svelte';
  import NoteViewSettingsDropdown from '../../NoteViewSettingsDropdown.svelte';

  let { kind }: { kind: 'note' | 'agent' } = $props();
</script>

<!-- State contracts use the real menu without Floating UI geometry in jsdom. -->
<Menu.Root staticPosition>
  <Menu.Trigger>Panel appearance</Menu.Trigger>
  <Menu.Content aria-label="Panel appearance">
    {#if kind === 'note'}
      <NoteViewSettingsDropdown workspaceId="view-settings" noteId="note-1" embedded />
    {:else}
      <AgentViewSettingsDropdown embedded />
    {/if}
  </Menu.Content>
</Menu.Root>
