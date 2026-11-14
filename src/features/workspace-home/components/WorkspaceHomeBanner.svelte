<script lang="ts">
  /**
   * The workspace's home banner (PROTOCOL `methods/nodes.md` → "Detached
   * workspaces"): a detached home with Wait and Move home…, a move in
   * progress, or a home whose backups are failing. Renders nothing otherwise.
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import {
    faArrowRightArrowLeft,
    faCircleExclamation,
    faLinkSlash,
  } from '$lib/icons/phosphor-icons';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceHomeView } from '../workspace-home';
  import { homeBannerText } from '../workspace-home-copy';

  let {
    view,
    canMove = false,
    waiting = false,
    onWait,
    onMove,
  }: {
    view: WorkspaceHomeView | null;
    /** The viewer may move the home (owner or manager, no move running). */
    canMove?: boolean;
    /** A Wait retry is in flight. */
    waiting?: boolean;
    onWait?: () => void;
    onMove?: () => void;
  } = $props();

  const banner = $derived(view?.banner ?? null);
  const icon = $derived(
    banner === 'moving'
      ? faArrowRightArrowLeft
      : banner === 'detached'
        ? faLinkSlash
        : faCircleExclamation,
  );
</script>

{#if view && banner}
  <div
    role="status"
    class="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-4 py-3 {banner ===
    'moving'
      ? 'bg-muted/60'
      : 'bg-warning/10'}"
    data-workspace-home-banner={banner}
  >
    <Fa
      {icon}
      class="mt-0.5 size-4 shrink-0 {banner === 'moving' ? 'text-muted-foreground' : 'text-warning'}"
    />
    <p class="type-body min-w-48 flex-1 text-foreground">{homeBannerText(view)}</p>
    {#if banner === 'moving'}
      <IntentMarkLoader size={16} />
    {:else if banner === 'detached' || canMove}
      <div class="flex shrink-0 items-center gap-2">
        {#if view.canWait}
          <Button variant="outline" size="sm" disabled={waiting} onclick={() => onWait?.()}>
            {#if waiting}<IntentMarkLoader size={12} />{/if}
            {m.workspaceHome_wait_label()}
          </Button>
        {/if}
        {#if canMove}
          <Button variant="outline" size="sm" onclick={() => onMove?.()}>
            {m.workspaceHome_move_label()}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
