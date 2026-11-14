<script lang="ts">
  /**
   * What file, diff and terminal panels show while the home is detached or
   * moving (PROTOCOL `methods/nodes.md` → "Detached workspaces"): the same
   * reason as the banner instead of an empty view, with Wait and Move home….
   */
  import { EmptyState } from '$lib/components/patterns/screen';
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faArrowRightArrowLeft, faLinkSlash } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceHomeView } from '../workspace-home';
  import { homeMarkerLabel, homeUnavailableText } from '../workspace-home-copy';

  let {
    view,
    canMove = false,
    waiting = false,
    onWait,
    onMove,
  }: {
    view: WorkspaceHomeView;
    canMove?: boolean;
    waiting?: boolean;
    onWait?: () => void;
    onMove?: () => void;
  } = $props();
</script>

<EmptyState class="h-full" data-workspace-home-panel-notice={view.state}>
  {#snippet icon()}
    <Fa icon={view.state === 'moving' ? faArrowRightArrowLeft : faLinkSlash} class="size-5" />
  {/snippet}
  {#snippet title()}
    {homeMarkerLabel(view.state === 'moving' ? 'moving' : 'detached')}
  {/snippet}
  {#snippet description()}
    {homeUnavailableText(view)}
  {/snippet}
  {#snippet actions()}
    <!-- Narrow panels: the actions wrap instead of overflowing. -->
    <div class="flex flex-wrap justify-center gap-2">
      {#if view.canWait}
        <Button variant="outline" size="sm" disabled={waiting} onclick={() => onWait?.()}>
          {m.workspaceHome_wait_label()}
        </Button>
      {/if}
      {#if canMove}
        <Button variant="outline" size="sm" onclick={() => onMove?.()}>
          {m.workspaceHome_move_label()}
        </Button>
      {/if}
    </div>
  {/snippet}
</EmptyState>
