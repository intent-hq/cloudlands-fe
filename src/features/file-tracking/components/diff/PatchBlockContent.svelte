<script lang="ts">
  /**
   * PatchBlockContent - Shared patch block UI used by both notes and chat.
   *
   * Renders a compact header with +/- stats, file label, optional apply/revert
   * button, and an expandable DiffViewer. Context-specific behavior (TipTap
   * integration, IPC calls) is handled by the parent via callback props.
   */
  import type { FilePatch, PatchLastApply } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faCheck, faRotateLeft, faSpinner, faPlusMinus } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { getNavigationContext } from '$lib/components/layout/panel-system/panel-context';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    patches: FilePatch[];
    label?: string;
    lastApply?: PatchLastApply;
    linkedAgentId?: string;
    /** Workspace id used to route the workspace:open-agent dispatch. */
    workspaceId?: string;
    /** Whether apply/revert is in progress */
    applying?: boolean;
    /** Called when user clicks Apply. Omit to hide the button. */
    onApply?: () => void;
    /** Called when user clicks Revert. Omit to hide the button. */
    onRevert?: () => void;
  }

  let {
    patches,
    label = m.ui_patchBlock_label(),
    lastApply,
    linkedAgentId,
    workspaceId,
    applying = false,
    onApply,
    onRevert,
  }: Props = $props();

  // Component state
  let expanded = $state(false);
  let selectedPatchIndex = $state(0);

  // Derived
  let currentPatch = $derived(patches?.[selectedPatchIndex]);
  let isApplied = $derived(lastApply?.status === 'success');

  // Format diff lines for stats
  function countDiffStats(diff: string) {
    const lines = diff.split('\n');
    let addCount = 0;
    let removeCount = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) addCount++;
      else if (line.startsWith('-') && !line.startsWith('---')) removeCount++;
    }
    return { addCount, removeCount };
  }

  let diffStats = $derived(
    currentPatch ? countDiffStats(currentPatch.diff) : { addCount: 0, removeCount: 0 },
  );

  let buttonState = $derived.by(() => {
    if (applying) return { label: m.ui_patchBlock_applying_label(), icon: faSpinner, spin: true };
    if (isApplied)
      return { label: m.ui_patchBlock_revert_label(), icon: faRotateLeft, spin: false };
    return { label: m.ui_patchBlock_apply_label(), icon: faCheck, spin: false };
  });

  let showActionButton = $derived(!!(onApply || onRevert));

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleAction() {
    if (isApplied) onRevert?.();
    else onApply?.();
  }
</script>

{#if patches?.length}
  <div
    class="ws-block-widget type-body my-2 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-(--elevation-raised)"
  >
    <!-- Header row -->
    <div class="flex min-h-9 items-center gap-2 px-3 py-1.5">
      {#if linkedAgentId}
        <button
          type="button"
          class="shrink-0 rounded-sm transition-opacity hover:opacity-80"
          onclick={(event) => {
            if (!workspaceId) return;
            appStore.dispatch(
              openAgentTabRequested(workspaceId, {
                agentId: linkedAgentId,
                ...getNavigationContext(event),
              }),
            );
          }}
          title={m.ui_patchBlock_viewAgent_tooltip()}
        >
          <AgentAvatar agentId={linkedAgentId} variant="compact" />
        </button>
      {/if}
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
        onclick={toggleExpanded}
      >
        {#if !linkedAgentId}
          <Fa icon={faPlusMinus} size={10} class="text-muted-foreground" />
        {/if}
        <span class="type-body flex-1 truncate text-left font-medium text-foreground">{label}</span>
        <span class="type-caption shrink-0 tabular-nums">
          <span class="text-success">+{diffStats.addCount}</span>
          <span class="ml-1 text-danger">-{diffStats.removeCount}</span>
        </span>
        {#if isApplied}
          <span class="type-caption shrink-0 font-medium text-success">
            {m.ui_patchBlock_applied_label()}
          </span>
        {/if}
      </button>
      {#if showActionButton}
        <Button
          variant="ghost-light"
          size="sm"
          class="type-caption shrink-0"
          onclick={handleAction}
          disabled={applying}
        >
          <Fa icon={buttonState.icon} size="xs" class={buttonState.spin ? 'animate-spin' : ''} />
          {buttonState.label}
        </Button>
      {/if}
    </div>

    <!-- Expanded diff view -->
    {#if expanded}
      <div transition:slide={{ duration: 150 }} class="border-t border-border p-2">
        {#if patches.length > 1}
          <div class="mb-2 flex gap-1">
            {#each patches as patch, i (`patch-${i}-${patch.filePath}`)}
              <Button
                variant={i === selectedPatchIndex ? 'default' : 'ghost-light'}
                size="sm"
                class="type-caption"
                onclick={() => (selectedPatchIndex = i)}
              >
                {patch.filePath.split('/').pop()}
              </Button>
            {/each}
          </div>
        {/if}

        {#if currentPatch}
          <DiffViewer
            patch={currentPatch.diff}
            fileName={currentPatch.filePath}
            showHeader={true}
            showStats={true}
            showLineNumbers={true}
            maxHeight="300px"
            collapsible={false}
            class="overflow-hidden rounded-sm border border-border"
          />
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="ws-block-widget type-caption my-2 text-muted-foreground">
    {m.ui_patchBlock_invalid_error()}
  </div>
{/if}
