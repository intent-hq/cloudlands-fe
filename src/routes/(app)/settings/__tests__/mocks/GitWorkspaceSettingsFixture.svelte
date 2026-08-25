<script lang="ts">
  import type { Snippet } from 'svelte';
  import SettingsStateFixture from './SettingsStateFixture.svelte';

  let {
    shellAdditions,
    workspaceAdditions,
  }: { shellAdditions?: Snippet; workspaceAdditions?: Snippet } = $props();
</script>

<div data-settings-git-workspace>
  <div id="git">
    <h2>Git</h2>
    <SettingsStateFixture />
  </div>
  <div id="shell">
    <h2>Shell</h2>
    {#if shellAdditions}{@render shellAdditions()}{/if}
  </div>
  <div id="workspace">
    <h2>Workspace</h2>
    {#if workspaceAdditions}{@render workspaceAdditions()}{/if}
  </div>
</div>
