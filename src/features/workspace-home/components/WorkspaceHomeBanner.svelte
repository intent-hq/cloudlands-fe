<script lang="ts">
  /**
   * The workspace's home banner (PROTOCOL `methods/nodes.md` → "Detached
   * workspaces", "Opening the home"): a detached home with Wait and Move
   * home…, a move in progress, the home still opening on its machine ("Setting
   * up home on Mac Studio…" with its step), an open or setup script that
   * failed (with its output), or a home whose backups are failing. Renders
   * nothing otherwise.
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import {
    faArrowRightArrowLeft,
    faCircleExclamation,
    faLinkSlash,
    faXmark,
  } from '$lib/icons/phosphor-icons';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import RemoteSetupLog from '$features/remote-machines/RemoteSetupLog.svelte';
  import type { WorkspaceHomeView } from '../workspace-home';
  import {
    homeBannerText,
    homeOpenFailureReason,
    homeSetupDetail,
    homeSetupTitle,
  } from '../workspace-home-copy';

  let {
    view,
    canMove = false,
    waiting = false,
    onWait,
    onMove,
    outputOpen = false,
    output,
    outputTruncated = false,
    onToggleOutput,
    onDismiss,
  }: {
    view: WorkspaceHomeView | null;
    /** The viewer may move the home (owner or manager, no move running). */
    canMove?: boolean;
    /** A Wait retry is in flight. */
    waiting?: boolean;
    onWait?: () => void;
    onMove?: () => void;
    /** The home's checkout and setup output is shown. */
    outputOpen?: boolean;
    /** That output, from the workspace's detail read; undefined until read. */
    output?: string;
    outputTruncated?: boolean;
    onToggleOutput?: () => void;
    /** Hides a failed opening's banner. */
    onDismiss?: () => void;
  } = $props();

  const banner = $derived(view?.banner ?? null);
  const icon = $derived(
    banner === 'moving'
      ? faArrowRightArrowLeft
      : banner === 'detached'
        ? faLinkSlash
        : faCircleExclamation,
  );
  const logId = $props.id();
  const setupBanner = $derived(banner === 'opening' || banner === 'setupFailed');
  const reason = $derived(view ? homeOpenFailureReason(view) : null);
  // Every opening and failure has a log: a preparing home shows its fetch
  // and checkout lines.
  const canShowOutput = $derived(setupBanner && !!onToggleOutput);
</script>

{#snippet outputToggle()}
  {#if canShowOutput}
    <Button
      variant="ghost-light"
      size="compact"
      class="shrink-0"
      aria-expanded={outputOpen}
      aria-controls={logId}
      onclick={() => onToggleOutput?.()}
    >
      {outputOpen ? m.remoteAgent_setup_hideOutput() : m.remoteAgent_setup_showOutput()}
    </Button>
  {/if}
{/snippet}

{#if view && setupBanner}
  {@const failed = banner === 'setupFailed'}
  {@const detail = homeSetupDetail(view)}
  <div
    class="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-border px-4 py-3 {failed
      ? 'bg-warning/10'
      : 'bg-muted/60'}"
    data-workspace-home-banner={banner}
    data-workspace-home-setup={view.setup?.phase}
  >
    {#if failed}
      <Fa icon={faCircleExclamation} class="mt-0.5 size-4 shrink-0 text-warning" />
    {:else}
      <span class="mt-0.5 shrink-0" aria-hidden="true"><IntentMarkLoader size={16} /></span>
    {/if}
    <div class="min-w-48 flex-1 space-y-0.5">
      <!-- The live region: a step change is announced politely, a failure at once. -->
      <div role={failed ? 'alert' : 'status'}>
        <p class="type-body text-foreground">{homeSetupTitle(view)}</p>
        {#if detail}
          <p class="type-caption text-muted-foreground">{detail}</p>
        {/if}
      </div>
      {#if reason}
        <p class="type-caption break-words font-mono text-subtle">{reason}</p>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {@render outputToggle()}
      {#if failed && view.setup?.phase === 'openFailed' && canMove}
        <Button variant="outline" size="sm" onclick={() => onMove?.()}>
          {m.workspaceHome_move_label()}
        </Button>
      {/if}
      {#if failed && onDismiss}
        <Button
          variant="ghost-light"
          size="icon-sm"
          aria-label={m.workspaceHome_setupFailed_dismiss()}
          onclick={() => onDismiss?.()}
        >
          <Fa icon={faXmark} class="size-3.5" />
        </Button>
      {/if}
    </div>
    {#if outputOpen}
      <div class="min-w-0 basis-full" id={logId}>
        <RemoteSetupLog machine={view.name} {output} truncated={outputTruncated} />
      </div>
    {/if}
  </div>
{:else if view && banner}
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
      class="mt-0.5 size-4 shrink-0 {banner === 'moving'
        ? 'text-muted-foreground'
        : 'text-warning'}"
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
