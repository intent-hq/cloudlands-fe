<script lang="ts">
  import type { Snippet } from 'svelte';
  import SettingsStateFixture from './SettingsStateFixture.svelte';

  let { shellAdditions }: { shellAdditions?: Snippet } = $props();
</script>

<div data-settings-git-workspace>
  <div id="git">
    <h2>Git</h2>
    <SettingsStateFixture />
  </div>
  <div id="shell">
    <h2>Shell</h2>
    {#if shellAdditions}<div id="cli-optimization" data-highlight-id="cli-optimization">
        {@render shellAdditions()}
      </div>{/if}
  </div>
  <div id="workspace">
    <h2>Workspace</h2>
  </div>
</div>
