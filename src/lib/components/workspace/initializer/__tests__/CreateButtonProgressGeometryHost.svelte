<script lang="ts">
  /**
   * CT host for `CreateButtonProgress` geometry. Drives the real renderer
   * store (the CT bundle initializes it) with one registered create frozen
   * at `percent`, and renders the wrapped Create button next to an unwrapped
   * reference Button with identical content — mirroring the
   * `CompactWorkspaceInitializer` `createButton` snippet while creating — so
   * the bar's placement, the button footprint, and its elevation can be
   * compared from real bounding boxes.
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import WorkspaceCreateButton from '../WorkspaceCreateButton.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    beginWorkspaceCreateProgress,
    clearWorkspaceCreateProgress,
    workspaceCreateProgressReceived,
  } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
  import CreateButtonProgress from '../CreateButtonProgress.svelte';
  import { createProgressLabel } from '../create-progress-label';

  let { percent }: { percent: number } = $props();

  const progressId = 'ct-create-button-progress';
  const phase = 'receiving';
  const fallbackLabel = m.workspace_compactInitializer_stagePreparing_label();
  // Same text the wrapped button shows once live, so the reference button's
  // footprint is comparable; the spec asserts the two labels match.
  const referenceLabel = $derived(
    createProgressLabel({ phase, percent, sawFrame: true, done: false }),
  );

  onMount(() => {
    appStore.dispatch(beginWorkspaceCreateProgress(progressId));
    appStore.dispatch(workspaceCreateProgressReceived(progressId, { phase, percent }));
    return () => {
      appStore.dispatch(clearWorkspaceCreateProgress(progressId));
    };
  });
</script>

<div class="flex w-80 flex-col items-start gap-6 bg-background p-6 text-foreground">
  <CreateButtonProgress class="w-full" {progressId} {fallbackLabel}>
    {#snippet children(label)}
      <WorkspaceCreateButton creating {label} data-testid="wrapped-button" />
    {/snippet}
  </CreateButtonProgress>

  <WorkspaceCreateButton creating label={referenceLabel} data-testid="reference-button" />
</div>
