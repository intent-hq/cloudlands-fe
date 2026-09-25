<script lang="ts">
  /**
   * Small HUD naming the encoder's latest effort or workspace choice.
   * Purely presentational; the device saga hides it after rotation inactivity.
   * Sits at z-70 so it stays visible above modal overlays (z-60).
   */
  import { reasoningEffortLabel } from '$features/agent/utils/reasoning-effort-label';
  import { fade } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectEncoderEffortFeedback,
    selectEncoderHudWorkspaceId,
    selectEncoderHudWorkspaceTitle,
  } from '$store/renderer/slices/hardware-console/hardware-console-selectors';

  const feedback$ = selectEncoderEffortFeedback();
  const hudWorkspaceId$ = selectEncoderHudWorkspaceId();
  const hudWorkspaceTitle$ = selectEncoderHudWorkspaceTitle();

  const title = $derived.by(() => {
    if ($feedback$)
      return m.hardwareConsole_encoderEffort_tooltip({
        level: reasoningEffortLabel($feedback$.effort),
      });
    if ($hudWorkspaceId$ === null) return null;
    return $hudWorkspaceTitle$?.trim() || m.hardwareConsole_encoderHud_untitled_label();
  });
</script>

{#if title !== null}
  <div
    class="fixed bottom-8 left-1/2 -translate-x-1/2 z-70 pointer-events-none"
    in:fade={{ tier: 'moderate' }}
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-label={$feedback$
      ? m.chat_effortPicker_title_label()
      : m.hardwareConsole_encoderHud_ariaLabel()}
  >
    <div
      class="type-caption bg-popover border border-border shadow-lg rounded-lg px-4 py-2 font-medium text-foreground max-w-96 truncate"
    >
      {title}
    </div>
  </div>
{/if}
