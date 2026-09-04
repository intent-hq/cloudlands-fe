<script lang="ts">
  import { state as tooltip, formatUrlForDisplay } from './link-tooltip-state.svelte';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
  import GitHubLinkCard from './GitHubLinkCard.svelte';

  const isMac = isMacPlatform();
  const modifierKey = isMac ? '⌘' : 'Ctrl';
  const VIEWPORT_MARGIN = 8;

  // Measured so the wider GitHub card clamps to the viewport by its real size
  let tooltipWidth = $state(0);
  let tooltipHeight = $state(0);

  // Flip below the link when the card would not fit above it
  const placeBelow = $derived(
    tooltip.visible && tooltip.y - VIEWPORT_MARGIN - tooltipHeight < VIEWPORT_MARGIN,
  );

  // Position the tooltip above the link, centered horizontally
  // Adjust if it would go off-screen
  const tooltipStyle = $derived.by(() => {
    if (!tooltip.visible) return 'display: none;';
    const half = tooltipWidth / 2;
    const x = Math.max(
      VIEWPORT_MARGIN + half,
      Math.min(tooltip.x, window.innerWidth - VIEWPORT_MARGIN - half),
    );
    // 8px gap above the link (or below it when flipped)
    const y = placeBelow ? tooltip.anchorBottom + VIEWPORT_MARGIN : tooltip.y - VIEWPORT_MARGIN;
    return `left: ${x}px; top: ${y}px;`;
  });

  const displayUrl = $derived(formatUrlForDisplay(tooltip.url));
  const isMailto = $derived(tooltip.url.startsWith('mailto:'));
  // GitHub issue/PR links open the action menu on plain click, not the browser
  const isGitHubIssueOrPr = $derived(parseGitHubIssueOrPrUrl(tooltip.url) !== null);
  // The hover card takes over while details load or once they arrive;
  // `idle` / `error` keep the plain URL tooltip.
  const cardPreview = $derived(
    tooltip.preview.status === 'loading' || tooltip.preview.status === 'ready'
      ? tooltip.preview
      : null,
  );
  const hintText = $derived(
    isMailto
      ? m.ui_linkTooltip_copyHint_tooltip({ key: modifierKey })
      : isGitHubIssueOrPr
        ? m.ui_linkTooltip_gitHubActionsHint_tooltip({ key: modifierKey })
        : m.ui_linkTooltip_inAppHint_tooltip({ key: modifierKey }),
  );
</script>

<Portal zIndex={70}>
  {#if tooltip.visible}
    <div
      class="link-tooltip"
      class:link-tooltip--card={cardPreview !== null}
      class:link-tooltip--below={placeBelow}
      style={tooltipStyle}
      role="tooltip"
      bind:clientWidth={tooltipWidth}
      bind:clientHeight={tooltipHeight}
    >
      {#if cardPreview}
        <GitHubLinkCard url={tooltip.url} preview={cardPreview} />
      {:else}
        <div class="link-tooltip-url">{displayUrl}</div>
      {/if}
      <div class="link-tooltip-hint">
        {tooltip.copied ? m.ui_linkTooltip_copied_label() : hintText}
      </div>
    </div>
  {/if}
</Portal>

<style>
  :global(.link-tooltip) {
    position: fixed;
    z-index: var(--layer-tooltip);
    transform: translateX(-50%) translateY(-100%);
    pointer-events: none;
    max-width: 400px;
    padding: 6px 10px 4px;
    border-radius: var(--radius-medium);
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    box-shadow: var(--elevation-overlay);
    font-size: 12px;
    line-height: 1.4;
    animation: link-tooltip-in var(--motion-fast) var(--ease-emphasized-out);
  }

  :global(.link-tooltip--card) {
    width: min(360px, calc(100vw - 16px));
    max-width: none;
    padding: 8px 10px 5px;
  }

  :global(.link-tooltip--card .link-tooltip-hint) {
    margin-top: 4px;
  }

  :global(.link-tooltip--below) {
    transform: translateX(-50%);
    animation-name: link-tooltip-in-below;
  }

  /* Inline rendering (sandbox): no fixed positioning or entrance motion. */
  :global(.link-tooltip--static) {
    position: static;
    transform: none;
    animation: none;
  }

  :global(.github-link-card) {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  :global(.github-link-card-header) {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }

  :global(.github-link-card-ref) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.github-link-card-title) {
    font-weight: 500;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  :global(.github-link-card-meta),
  :global(.github-link-card-branches) {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }

  :global(.github-link-card-branches) {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  :global(.github-link-card-skeleton) {
    display: grid;
    gap: 6px;
    padding: 3px 0 4px;
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

  @keyframes -global-link-tooltip-in-below {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.link-tooltip) {
      animation: none;
    }
  }
</style>
