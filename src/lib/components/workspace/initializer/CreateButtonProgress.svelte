<!--
  Live provisioning progress inside the Create-workspace button: a localized
  stage label + percent driven by the daemon's git:clone:progress frames
  (workspaceCreateProgress slice, keyed by the FE-minted progressId), plus a
  2px determinate bar pinned to the button's bottom edge. Until the first
  frame arrives (sawFrame false) the caller-provided fallback label — the
  legacy timed stage text — renders unchanged and no bar is drawn. Percent
  (text and bar) is monotonic: a late or re-ordered frame never moves it
  backwards. The nearest positioned ancestor (the Button, given `relative`)
  anchors the bar.
-->
<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { selectWorkspaceCreateProgress } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-selectors';
  import { createProgressLabel, formatCreateProgressPercent } from './create-progress-label';

  let { progressId, fallbackLabel }: { progressId: string; fallbackLabel: string } = $props();

  // Selector readables bind at component init only (STATE_MANAGEMENT.md);
  // the caller keys this component's lifetime to one create, so the initial
  // progressId is the only one it ever renders.
  // svelte-ignore state_referenced_locally
  const entry$ = selectWorkspaceCreateProgress(progressId);

  // Monotonic floor: track the highest percent seen so the label and bar
  // never move backwards even if frames arrive out of order. Clamped to 100
  // at the source so text, bar width, and ARIA can never disagree (negatives
  // are excluded by the > maxPercent guard against the initial 0).
  let maxPercent = $state(0);
  $effect(() => {
    const percent = Math.min($entry$?.percent ?? 0, 100);
    if (percent > maxPercent) maxPercent = percent;
  });

  const live = $derived($entry$?.sawFrame === true);
</script>

{#if live && $entry$}
  <span data-testid="create-progress-label">
    {m.workspaceCreation_progressWithPercent_label({
      label: createProgressLabel($entry$),
      percent: formatCreateProgressPercent(maxPercent),
    })}
  </span>
  <div
    class="absolute bottom-0 left-0 h-[2px] bg-white/80 transition-[width] duration-300 ease-out"
    style="width: {maxPercent}%"
    role="progressbar"
    aria-label={createProgressLabel($entry$)}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={maxPercent}
    data-testid="create-progress-bar"
  ></div>
{:else}
  {fallbackLabel}
{/if}
