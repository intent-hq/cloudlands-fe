<script lang="ts">
  /**
   * CT harness: the real notch shell (the dock rail preview: DockRail →
   * AdaptiveDockShell, with its fake native placement acknowledgements) disclosing
   * the real DockConversation — composer, ModelPicker, EffortPicker — over the
   * synthetic daemon/preload boundary of the wire fixtures. The preview's pointer
   * controller stands in for main's ignore-mouse switch and records every published
   * region (`data-preview-pointer`).
   */
  import { onMount } from 'svelte';
  // As the dock route: the renderer bridge answers agent:set-model with the daemon call.
  import '$store/renderer/seeders/agent-ipc-bridge-seeder';
  import '$lib/styles/dock-tokens.css';
  import { store } from '$store/renderer/store';
  import { openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import DockConversation from '../DockConversation.svelte';
  import DockRailPreview from '../dock-rail.preview.svelte';
  import { dockRailPreview } from '../dock-rail.preview-fixtures';
  import {
    conversationWireWorkspace,
    setupConversationWire,
    type ConversationWireCall,
  } from '../dock-conversation-wire.preview-fixtures';

  let { providerChoice = false }: { providerChoice?: boolean } = $props();
  let ready = $state(false);
  let calls = $state<ConversationWireCall[]>([]);
  onMount(() => {
    const fixture = setupConversationWire((call) => (calls = [...calls, call]), {
      providerChoice,
    });
    store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    ready = true;
    return () => fixture.dispose();
  });
</script>

{#snippet conversation()}
  <DockConversation onOpenWorkspace={() => {}} />
{/snippet}

<div data-testid="notch-picker-harness" data-calls={JSON.stringify(calls)}>
  {#if ready}
    <DockRailPreview
      {...dockRailPreview.states.notch.props}
      conversationFixture
      conversationContent={conversation}
    />
  {/if}
</div>
