<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import DockOverview from './DockOverview.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';

  let {
    workspaces,
    olderWorkspaces = [],
    showOlder = $bindable(false),
    query = $bindable(''),
    pending,
    expanded,
    reveal,
    floating,
    floatingUp,
    settling = false,
    clip,
    conversation,
    conversationWorkspaceId,
    focusRequest,
    focusComposerOnMount = false,
    onOpen,
    onRegionsChange,
    onPopupStateChange,
  }: {
    workspaces: DockWorkspaceView[];
    olderWorkspaces?: DockWorkspaceView[];
    showOlder?: boolean;
    /** The index search text (kept by the shell across a conversation). */
    query?: string;
    pending: boolean;
    expanded: boolean;
    reveal: number;
    floating: boolean;
    floatingUp: boolean;
    /** The visible shell is still settling to a new height and clips the panel edges. */
    settling?: boolean;
    /** Visible shell ink in viewport CSS pixels for inline region publication. */
    clip?: () => DockPointerRect | null;
    conversation?: Snippet;
    conversationWorkspaceId?: string | null;
    focusRequest: number;
    /** A user gesture opened this conversation: focus its composer as it opens. */
    focusComposerOnMount?: boolean;
    onOpen: (id: string) => void;
    onRegionsChange: (regions: DockPointerRect[]) => void;
    onPopupStateChange: (open: boolean) => void;
  } = $props();
  const progress = $derived(Math.pow(reveal, 4));
</script>

<div
  class="overview-frame"
  class:floating
  class:floating-up={floatingUp}
  class:conversation-open={!!conversationWorkspaceId && !!conversation}
  inert={!expanded || reveal === 0}
  aria-hidden={!expanded || reveal === 0}
  style:opacity={progress}
  style:transform={`translateY(${(floatingUp ? 4 : -4) * (1 - progress)}px)`}
>
  {#if conversationWorkspaceId && conversation}
    <DockConversationSurface
      workspaceId={conversationWorkspaceId}
      {focusRequest}
      {focusComposerOnMount}
      resizable={!settling}
      {clip}
      active={expanded && reveal === 1}
      focusActive={expanded && reveal > 0}
      {onRegionsChange}
      {onPopupStateChange}
    >
      {@render conversation()}
    </DockConversationSurface>
  {:else}
    <DockOverview {workspaces} {olderWorkspaces} bind:showOlder {pending} {onOpen} bind:query />
  {/if}
</div>

<style>
  .overview-frame {
    position: absolute;
    top: var(--header-height);
    bottom: 0;
    left: 0;
    right: 0;
    /* The Assistant row closes the list; its own inset is the bottom margin. */
    padding: 8px 12px 8px;
  }
  .overview-frame:not(.conversation-open) {
    height: var(--dock-overview-height, auto);
  }
  .floating-up:not(.conversation-open) {
    top: auto;
  }
  .floating-up {
    top: 0;
    bottom: var(--header-height);
    padding-block: 12px 8px;
  }
  .conversation-open {
    padding: 0;
  }
</style>
