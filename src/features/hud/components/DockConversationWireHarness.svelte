<script lang="ts">
  import { onMount } from 'svelte';
  import type { Theme } from '$lib/utils/theme';
  import '$lib/styles/dock-tokens.css';
  import DockConversation from './DockConversation.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import type { DockPointerRect } from '$shared/dock-layout';
  import {
    setupConversationWire,
    conversationWireWorkspace,
    type ConversationWireCall,
  } from './dock-conversation-wire.preview-fixtures';
  import { store } from '$store/renderer/store';
  import { setAgentStreaming } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setChatAuroraEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { selectDockConversationView } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  let ready = $state(false);
  let {
    width = 420,
    height = 520,
    failPlacementOnce = false,
    notchChrome = false,
    dockAppearance = false,
    initialMessage,
  }: {
    width?: number;
    height?: number;
    failPlacementOnce?: boolean;
    notchChrome?: boolean;
    dockAppearance?: boolean;
    initialMessage?: string;
  } = $props();
  let surfaceActive = $state(true);
  let regions = $state<DockPointerRect[]>([]);
  let calls = $state<ConversationWireCall[]>([]);
  let fullTarget = $state('');
  let diagnostic = $state('');
  let fixture: ReturnType<typeof setupConversationWire>;
  onMount(() => {
    fixture = setupConversationWire(
      (call) => {
        calls = [...calls, call];
      },
      { failPlacementOnce, initialMessage, dockAppearance },
    );
    const stopState = store.getReadableState().subscribe((state) => {
      diagnostic = JSON.stringify({
        view: selectDockConversationView.select(state),
        dock: state.dockConversation,
        chat: state.chatState.byAgentId,
      });
    });
    store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    ready = true;
    return () => {
      stopState();
      fixture.dispose();
    };
  });
</script>

<div
  data-testid="conversation-wire"
  data-ready={ready}
  data-calls={JSON.stringify(calls)}
  data-full-target={fullTarget}
  data-diagnostic={diagnostic}
  data-regions={JSON.stringify(regions)}
>
  <div
    style:width={`${width}px`}
    style:height={`${height}px`}
    data-dock-surface={notchChrome ? 'notch' : undefined}
    data-expanded={notchChrome ? true : undefined}
  >
    {#if ready}<DockConversationSurface
        workspaceId={conversationWireWorkspace}
        active={surfaceActive}
        onRegionsChange={(value) => (regions = value)}
        ><DockConversation
          onOpenWorkspace={(workspaceId, agentId) => {
            fullTarget = `${workspaceId}:${agentId}`;
          }}
        /></DockConversationSurface
      >{/if}
  </div>
  {#if dockAppearance}
    {#each ['light', 'dark', 'system'] as preference}
      <button onclick={() => fixture.setThemePreference(preference as Theme)}>
        Use {preference} app preference
      </button>
    {/each}
  {/if}
  <button onclick={() => store.dispatch(setAgentStreaming('wire-main', true))}
    >Start synthetic stream</button
  >
  <button onclick={() => store.dispatch(setAgentStreaming('wire-main', false))}
    >End synthetic stream</button
  >
  <button onclick={() => store.dispatch(setChatAuroraEnabled(false))}
    >Disable Aurora preference</button
  >
  <button onclick={() => store.dispatch(setChatAuroraEnabled(true))}
    >Enable Aurora preference</button
  >
  <button onclick={() => (surfaceActive = !surfaceActive)}>Toggle synthetic surface activity</button
  >
  <button onclick={() => fixture.settle()}>Accept synthetic delivery</button>
  <button onclick={() => fixture.settle(false)}>Reject synthetic delivery</button>
  <button onclick={() => fixture.enhance()}>Resolve synthetic enhancement</button>
  <button onclick={() => fixture.append('wire-main', 'Fresh daemon notification')}
    >Publish synthetic reply</button
  >
</div>
