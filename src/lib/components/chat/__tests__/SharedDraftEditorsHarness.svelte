<script lang="ts">
  import { onMount } from 'svelte';
  import {
    setupSharedDraftFixture,
    type SharedDraftFixture,
  } from './shared-draft.preview-fixtures';
  import SharedDraftMainEditor from './SharedDraftMainEditor.svelte';
  import DockConversation from '$features/hud/components/DockConversation.svelte';
  import '$lib/styles/dock-tokens.css';
  let { outputReady = true }: { outputReady?: boolean } = $props();
  let fixture = $state<SharedDraftFixture>();
  let saved = $state('');
  let handoff = $state(false);
  onMount(() => {
    const active = setupSharedDraftFixture();
    fixture = active;
    window.__sharedDraftFixture = active;
    return () => {
      delete window.__sharedDraftFixture;
      active.dispose();
    };
  });
</script>

{#if fixture}
  <div data-testid="shared-editors" data-saved={saved} data-handoff={handoff}>
    <SharedDraftMainEditor
      {outputReady}
      driver={fixture.driver}
      workspaceId={fixture.workspaceId}
      agentId={fixture.agentId}
    />
    <div data-testid="shared-dock" style="height: 480px; width: 480px">
      <DockConversation
        onOpenWorkspace={async () => {
          await fixture?.handoff();
          handoff = true;
        }}
      />
    </div>
    <button
      onclick={async () => {
        saved = JSON.stringify(await fixture?.saved());
      }}>Read saved draft</button
    >
    <button onclick={() => fixture?.closeDock()}>Close notch draft</button>
    <button onclick={() => fixture?.openDock()}>Open notch draft</button>
    <button
      onclick={async () => {
        await fixture?.seedScreen();
      }}>Seed screenshot draft</button
    >
    <button onclick={() => fixture?.seedRecording()}>Seed recording draft</button>
  </div>
{/if}
