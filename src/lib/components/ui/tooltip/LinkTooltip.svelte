<script lang="ts">
  import {
  state,
  formatUrlForDisplay,
} from './link-tooltip-state.svelte';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  const isMac = isMacPlatform();
  const modifierKey = isMac ? '⌘' : 'Ctrl';

  // Position the tooltip above the link, centered horizontally
  // Adjust if it would go off-screen
  const tooltipStyle = $derived.by(() => {
    if (!state.visible) return 'display: none;';
    const x = Math.max(8, Math.min(state.x, window.innerWidth - 200));
    const y = state.y - 8; // 8px gap above the link
    return `left: ${x}px; top: ${y}px;`;
  });

  const displayUrl = $derived(formatUrlForDisplay(state.url));
  const isMailto = $derived(state.url.startsWith('mailto:'));
  const hintText = $derived(
    isMailto
      ? m.ui_linkTooltip_copyHint_tooltip({ key: modifierKey })
      : m.ui_linkTooltip_externalHint_tooltip({ key: modifierKey }),
  );
</script>

<Portal zIndex={99999}>
  {#if state.visible}
    <div
      class="link-tooltip"
      style={tooltipStyle}
      role="tooltip"
    >
      <div class="link-tooltip-url">{displayUrl}</div>
      <div class="link-tooltip-hint">{state.copied ? m.ui_linkTooltip_copied_label() : hintText}</div>
    </div>
  {/if}
</Portal>

<style>
  :global(.link-tooltip) {
    position: fixed;
    z-index: 99999;
    transform: translateX(-50%) translateY(-100%);
    pointer-events: none;
    max-width: 400px;
    padding: 6px 10px 4px;
    border-radius: 0;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    font-size: 12px;
    line-height: 1.4;
    animation: link-tooltip-in 0.08s ease-out;
  }

  :global(.link-tooltip-url) {
    font-size: 11px;
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.link-tooltip-hint) {
    font-size: 11px;
    opacity: 0.6;
    white-space: nowrap;
  }

  @keyframes -global-link-tooltip-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-100%) translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(-100%);
    }
  }
</style>
