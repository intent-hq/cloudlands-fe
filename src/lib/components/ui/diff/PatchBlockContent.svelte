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
  import {
  faCheck,
  faRotateLeft,
  faSpinner,
  faPlusMinus,
} from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import DiffViewer from './DiffViewer.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { store as appStore } from '$store/renderer/store';


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
    label = 'Patch',
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

  let diffStats = $derived(currentPatch ? countDiffStats(currentPatch.diff) : { addCount: 0, removeCount: 0 });

  let buttonState = $derived.by(() => {
    if (applying) return { label: 'Applying...', icon: faSpinner, spin: true };
    if (isApplied) return { label: 'Revert', icon: faRotateLeft, spin: false };
    return { label: 'Apply', icon: faCheck, spin: false };
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
  <div class="my-3">
    <!-- Header row -->
    <div class="flex items-center gap-2">
      {#if linkedAgentId}
        <button
          type="button"
          class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
          onclick={() => {
            if (!workspaceId) return;
            appStore.dispatch(openAgentTabRequested(workspaceId, { agentId: linkedAgentId }));
          }}
          title="View agent"
        >
          <AuggieAvatar agentId={linkedAgentId} size={16} />
        </button>
      {/if}
      <button
        type="button"
        class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0 cursor-pointer"
        onclick={toggleExpanded}
      >
        {#if !linkedAgentId}
          <Fa icon={faPlusMinus} size={10} class="text-ghost" />
        {/if}
        <span class="text-base truncate flex-1 text-left">{label}</span>
        <span class="text-xs font-mono">
          <span class="text-green-600">+{diffStats.addCount}</span>
          <span class="text-red-600 ml-1">-{diffStats.removeCount}</span>
        </span>
        {#if isApplied}
          <span class="text-xs text-green-600 font-medium">(applied)</span>
        {/if}
      </button>
      {#if showActionButton}
        <Button
          variant="ghost-light"
          size="sm"
          class="h-6 px-2 text-xs text-subtle gap-1 flex-none"
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
      <div transition:slide={{ duration: 150 }} class="mt-2">
        {#if patches.length > 1}
          <div class="flex gap-1 mb-2">
            {#each patches as patch, i (`patch-${i}-${patch.filePath}`)}
              <Button
                variant={i === selectedPatchIndex ? 'default' : 'ghost-light'}
                size="sm"
                class="h-6 px-2 text-xs"
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
            class="rounded border border-border overflow-hidden"
          />
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="my-1.5 text-sm text-subtle">Invalid patch block</div>
{/if}
