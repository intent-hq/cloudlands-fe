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
  import { installSyntheticNative } from './dock-composer-e2e.preview-fixtures';
  let ready = $state(false);
  let {
    width = 420,
    height = 520,
    failPlacementOnce = false,
    notchChrome = false,
    dockAppearance = false,
    initialMessage,
    syntheticNative = false,
    operationalHistory = 0,
    routeFrame = false,
  }: {
    width?: number;
    height?: number;
    failPlacementOnce?: boolean;
    notchChrome?: boolean;
    dockAppearance?: boolean;
    initialMessage?: string;
    /** Install the scripted native helper so capture and annotate controls are live. */
    syntheticNative?: boolean;
    /** Assistant turns of operational rows seeded before the initial message. */
    operationalHistory?: number;
    /**
     * Mirror the dock route: a fixed screen inside a 0×0 clipping wrapper, with a
     * shell that reveals from a scaled, clipped notch (button: Reveal synthetic dock).
     */
    routeFrame?: boolean;
  } = $props();
  let surfaceActive = $state(true);
  let revealed = $state(!routeFrame);
  let regions = $state<DockPointerRect[]>([]);
  let calls = $state<ConversationWireCall[]>([]);
  let fullTarget = $state('');
  let diagnostic = $state('');
  let fixture: ReturnType<typeof setupConversationWire>;
  onMount(() => {
    // Before the pair opens: the native-session saga reads the factory on open.
    const native = syntheticNative ? installSyntheticNative() : null;
    fixture = setupConversationWire(
      (call) => {
        calls = [...calls, call];
      },
      { failPlacementOnce, initialMessage, dockAppearance, operationalHistory },
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
      native?.uninstall();
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
  {#snippet surface()}
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
  {/snippet}
  {#if routeFrame}
    <!-- Like /dock: #app clips but has no box; the screen is fixed to the viewport. -->
    <div class="route-wrapper">
      <section class="route-screen">
        <div
          class="route-shell"
          data-revealed={revealed}
          style:width={`${width}px`}
          style:height={`${height}px`}
          data-dock-surface={notchChrome ? 'notch' : undefined}
          data-expanded={notchChrome ? true : undefined}
        >
          {@render surface()}
        </div>
        <button class="route-reveal" onclick={() => (revealed = true)}>Reveal synthetic dock</button
        >
      </section>
    </div>
  {:else}
    <div
      style:width={`${width}px`}
      style:height={`${height}px`}
      data-dock-surface={notchChrome ? 'notch' : undefined}
      data-expanded={notchChrome ? true : undefined}
    >
      {@render surface()}
    </div>
  {/if}
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
  <button onclick={() => store.dispatch(openDockConversationRequested(conversationWireWorkspace))}
    >Reopen synthetic workspace</button
  >
  <button onclick={() => fixture.askQuestions()}>Publish synthetic questions</button>
  <button onclick={() => fixture.askQuestions(true)}>Publish older synthetic questions</button>
  <button onclick={() => fixture.failNextDismissal()}>Reject next synthetic dismissal</button>
  <button onclick={() => fixture.loseSendResponse()}>Lose synthetic send response</button>
  <button onclick={() => fixture.settle()}>Accept synthetic delivery</button>
  <button onclick={() => fixture.settle(false)}>Reject synthetic delivery</button>
  <button onclick={() => fixture.enhance()}>Resolve synthetic enhancement</button>
  <button onclick={() => fixture.append('wire-main', 'Fresh daemon notification')}
    >Publish synthetic reply</button
  >
</div>

<style>
  .route-wrapper {
    overflow: clip;
  }
  .route-screen {
    position: fixed;
    inset: 0;
    overflow: clip;
  }
  .route-shell {
    position: absolute;
    left: 16px;
    top: 16px;
    overflow: hidden;
    transform-origin: top center;
    transform: scaleY(0.25);
    clip-path: inset(0 0 75% 0);
    transition:
      transform 240ms ease-out,
      clip-path 240ms ease-out;
  }
  .route-shell[data-revealed='true'] {
    transform: none;
    clip-path: inset(0);
  }
  .route-reveal {
    position: absolute;
    right: 8px;
    bottom: 8px;
  }
</style>
