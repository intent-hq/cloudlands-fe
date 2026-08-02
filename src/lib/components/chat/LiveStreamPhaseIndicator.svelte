<!--
  LiveStreamPhaseIndicator.svelte

  Per-agent live-hydration status line: while a turn is in flight and the
  standing chat.subscribe stream has not applied its seq-0 snapshot yet,
  shows a spinner + staged copy for the stream's lifecycle phase. Gated on a
  500ms grace period (debounced-show) so fast snapshots render nothing; once
  visible, copy switches phases instantly. Slides in/out so insertion and
  removal do not jar the message list.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onDestroy } from 'svelte';
  import { Spinner } from '$lib/components/ui/indicators';
  import type { LiveStreamPhase } from '$store/renderer/slices/chat-state/chat-state-types';
  import {
    LIVE_STREAM_PHASE_GRACE_MS,
    isPreLivePhase,
    liveStreamPhaseMessage,
    shouldShowLiveStreamPhaseIndicator,
  } from './live-stream-phase';

  interface Props {
    /** Current standing-subscription phase for the viewed agent. */
    phase?: LiveStreamPhase | null;
    /** Whether the agent's turn is in flight (isStreaming/isProcessing derivation). */
    turnInFlight?: boolean;
    /** Seed for spinner colors (typically agent ID). */
    seed?: string;
    /** Additional class names. */
    class?: string;
  }

  let { phase = null, turnInFlight = false, seed, class: className = '' }: Props = $props();

  const eligible = $derived(shouldShowLiveStreamPhaseIndicator({ phase, turnInFlight }));

  // Debounced-show: eligibility must persist for the full grace period
  // before the indicator renders. Hiding is immediate (phase reaches `live`,
  // turn ends, or teardown).
  let graceElapsed = $state(false);
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearGraceTimer() {
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  }

  $effect(() => {
    if (eligible) {
      if (!graceElapsed && graceTimer === null) {
        graceTimer = setTimeout(() => {
          graceTimer = null;
          graceElapsed = true;
        }, LIVE_STREAM_PHASE_GRACE_MS);
      }
    } else {
      clearGraceTimer();
      graceElapsed = false;
    }
  });

  onDestroy(clearGraceTimer);

  const visible = $derived(eligible && graceElapsed);
  const message = $derived(phase !== null && isPreLivePhase(phase) ? liveStreamPhaseMessage(phase) : '');
</script>

{#if visible}
  <div
    class="flex items-center gap-2 text-subtle py-1 pl-2 {className}"
    data-testid="live-stream-phase-indicator"
    transition:slide={{ duration: 200, easing: cubicOut }}
  >
    <Spinner {seed} size={4} />
    <span class="text-xs text-subtle font-medium" data-testid="live-stream-phase-message"
      >{message}</span>
  </div>
{/if}
