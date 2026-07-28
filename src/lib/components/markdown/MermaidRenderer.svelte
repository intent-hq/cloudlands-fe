<script lang="ts">
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import {
  faExpand,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import mermaid from 'mermaid';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('MermaidRenderer');

  interface Props {
    code: string;
    className?: string;
    showExpandButton?: boolean;
  }

  let { code, className = '', showExpandButton = true }: Props = $props();

  let renderedSvg = $state('');
  let error = $state<string | null>(null);
  let mounted = $state(false);
  let isFullscreen = $state(false);
  let fullscreenSvg = $state('');
  let fullscreenDialogElement: HTMLDivElement | undefined = $state();
  const isDarkTheme = selectIsDarkTheme();

  // Decode base64 encoded mermaid code
  function decodeBase64(str: string): string {
    try {
      // Check if it looks like base64 (no newlines, only base64 chars)
      if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
        return decodeURIComponent(escape(atob(str)));
      }
      // Fall back to treating as plain text (for backwards compatibility)
      return str;
    } catch {
      // If base64 decode fails, return as-is
      return str;
    }
  }

  // Decode HTML entities that may have been escaped (legacy support)
  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  function initMermaid(isDark: boolean) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: 'inherit',
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        curve: 'linear',
        padding: 12,
      },
      sequence: {
        useMaxWidth: false,
        wrap: true,
        mirrorActors: false,
      },
      themeVariables: isDark ? {
        // Dark theme - subtle, muted colors
        primaryColor: 'hsl(240 3.7% 15.9%)',
        primaryTextColor: 'hsl(0 0% 63.9%)',
        primaryBorderColor: 'hsl(240 3.7% 25%)',
        lineColor: 'hsl(240 3.7% 35%)',
        secondaryColor: 'hsl(240 3.7% 12%)',
        tertiaryColor: 'hsl(240 3.7% 10%)',
        background: 'transparent',
        mainBkg: 'hsl(240 3.7% 15.9%)',
        nodeBorder: 'hsl(240 3.7% 25%)',
        clusterBkg: 'hsl(240 3.7% 12%)',
        clusterBorder: 'hsl(240 3.7% 25%)',
        titleColor: 'hsl(0 0% 63.9%)',
        edgeLabelBackground: 'hsl(240 3.7% 15.9%)',
        textColor: 'hsl(0 0% 63.9%)',
        nodeTextColor: 'hsl(0 0% 63.9%)',
        actorTextColor: 'hsl(0 0% 63.9%)',
        actorBkg: 'hsl(240 3.7% 15.9%)',
        actorBorder: 'hsl(240 3.7% 25%)',
        actorLineColor: 'hsl(240 3.7% 30%)',
        signalColor: 'hsl(0 0% 63.9%)',
        signalTextColor: 'hsl(0 0% 63.9%)',
        labelBoxBkgColor: 'hsl(240 3.7% 15.9%)',
        labelBoxBorderColor: 'hsl(240 3.7% 25%)',
        labelTextColor: 'hsl(0 0% 63.9%)',
        loopTextColor: 'hsl(0 0% 63.9%)',
        noteBkgColor: 'hsl(240 3.7% 18%)',
        noteBorderColor: 'hsl(240 3.7% 25%)',
        noteTextColor: 'hsl(0 0% 63.9%)',
      } : {
        // Light theme - subtle, muted colors
        primaryColor: 'hsl(0 0% 96.1%)',
        primaryTextColor: 'hsl(240 5.9% 30%)',
        primaryBorderColor: 'hsl(240 5.9% 85%)',
        lineColor: 'hsl(240 5.9% 70%)',
        secondaryColor: 'hsl(0 0% 98%)',
        tertiaryColor: 'hsl(0 0% 96%)',
        background: 'transparent',
        mainBkg: 'hsl(0 0% 96.1%)',
        nodeBorder: 'hsl(240 5.9% 85%)',
        clusterBkg: 'hsl(0 0% 98%)',
        clusterBorder: 'hsl(240 5.9% 85%)',
        titleColor: 'hsl(240 5.9% 30%)',
        edgeLabelBackground: 'hsl(0 0% 96.1%)',
        textColor: 'hsl(240 5.9% 30%)',
        nodeTextColor: 'hsl(240 5.9% 30%)',
        actorTextColor: 'hsl(240 5.9% 30%)',
        actorBkg: 'hsl(0 0% 96.1%)',
        actorBorder: 'hsl(240 5.9% 85%)',
        actorLineColor: 'hsl(240 5.9% 80%)',
        signalColor: 'hsl(240 5.9% 30%)',
        signalTextColor: 'hsl(240 5.9% 30%)',
        labelBoxBkgColor: 'hsl(0 0% 96.1%)',
        labelBoxBorderColor: 'hsl(240 5.9% 85%)',
        labelTextColor: 'hsl(240 5.9% 30%)',
        loopTextColor: 'hsl(240 5.9% 30%)',
        noteBkgColor: 'hsl(0 0% 94%)',
        noteBorderColor: 'hsl(240 5.9% 85%)',
        noteTextColor: 'hsl(240 5.9% 30%)',
      },
    });
  }

  async function renderDiagram(rawCode: string, isDark: boolean) {
    // First decode base64, then decode any HTML entities (for legacy support)
    const base64Decoded = decodeBase64(rawCode);
    const decodedCode = decodeHtmlEntities(base64Decoded);

    if (!decodedCode?.trim()) {
      renderedSvg = '';
      error = null;
      return;
    }

    try {
      initMermaid(isDark);

      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const { svg } = await mermaid.render(id, decodedCode);
      renderedSvg = svg;
      error = null;
    } catch (err) {
      logger.error('Failed to render mermaid diagram:', err);
      error = err instanceof Error ? err.message : m.markdown_mermaid_renderFailed_error();
      renderedSvg = '';
    }
  }

  function openFullscreen(e: MouseEvent) {
    // Prevent event propagation to avoid editor selection issues
    e.stopPropagation();
    e.preventDefault();
    // Blur any focused element to avoid RangeError from ProseMirror
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    fullscreenSvg = renderedSvg;
    isFullscreen = true;
  }

  function closeFullscreen() {
    isFullscreen = false;
    fullscreenSvg = '';
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      closeFullscreen();
    }
  }

  onMount(() => {
    mounted = true;
  });

  // Escape layer: registered only while fullscreen so stacked overlays
  // dismiss one at a time in LIFO order
  $effect(() => {
    if (!isFullscreen) return;
    return pushEscapeLayer(() => closeFullscreen());
  });

  // Auto-focus the fullscreen dialog when it opens for accessibility
  $effect(() => {
    if (isFullscreen && fullscreenDialogElement) {
      try {
        fullscreenDialogElement.focus();
      } catch {
        // Defensive: ignore focus errors from ProseMirror selection reconciliation
      }
    }
  });

  // Re-render when code changes (after mount)
  $effect(() => {
    if (mounted && code) {
      renderDiagram(code, $isDarkTheme);
    }
  });
</script>

<div class="mermaid-renderer {className}">
  {#if error}
    <div class="mermaid-error">
      <pre class="error-message">{error}</pre>
      <details class="error-source">
        <summary>{m.markdown_mermaid_viewSource_label()}</summary>
        <pre>{decodeHtmlEntities(decodeBase64(code))}</pre>
      </details>
    </div>
  {:else if renderedSvg}
    <div class="mermaid-svg-container">
      <div class="mermaid-svg">
        {@html renderedSvg}
      </div>
      {#if showExpandButton}
        <button
          class="expand-button"
          onclick={openFullscreen}
          title={m.markdown_mermaid_expand_tooltip()}
          aria-label={m.markdown_mermaid_expand_ariaLabel()}
        >
          <Fa icon={faExpand} size="sm" />
        </button>
      {/if}
    </div>
  {:else if !code?.trim()}
    <div class="mermaid-empty">{m.markdown_mermaid_noCode_label()}</div>
  {:else}
    <div class="mermaid-loading">
      <div class="loading-spinner"></div>
    </div>
  {/if}
</div>

{#if isFullscreen}
  <div
    class="fullscreen-overlay"
    onclick={handleBackdropClick}
    onkeydown={(e) => { if (e.key === 'Escape') closeFullscreen(); }}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label={m.markdown_mermaid_fullscreenView_ariaLabel()}
    bind:this={fullscreenDialogElement}
  >
    <div class="fullscreen-content">
      <button
        class="close-button"
        onclick={closeFullscreen}
        title={m.markdown_mermaid_closeFullscreen_tooltip()}
        aria-label={m.markdown_mermaid_closeFullscreen_ariaLabel()}
      >
        <Fa icon={faTimes} size="sm" />
      </button>
      <div class="fullscreen-diagram">
        {@html fullscreenSvg}
      </div>
    </div>
  </div>
{/if}

<style>
  .mermaid-renderer {
    width: 100%;
    overflow-x: auto;
  }

  .mermaid-svg-container {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .mermaid-svg-container:hover .expand-button {
    opacity: 1;
  }

  .mermaid-svg {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .mermaid-svg :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .expand-button {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 6px 8px;
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
    display: flex;
    align-items: center;
    justify-content: center;
    color: hsl(var(--foreground));
    z-index: 10;
  }

  .expand-button:hover {
    background: hsl(var(--muted));
    border-color: hsl(var(--muted-foreground));
  }

  .expand-button:active {
    transform: scale(0.95);
  }

  .fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }

  .fullscreen-content {
    position: relative;
    background: hsl(var(--background));
    border-radius: 8px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
  }

  .close-button {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 6px 8px;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: hsl(var(--foreground));
    z-index: 1001;
    transition: background 0.2s ease-in-out;
  }

  .close-button:hover {
    background: hsl(var(--muted) / 0.8);
  }

  .close-button:active {
    transform: scale(0.95);
  }

  .fullscreen-diagram {
    padding: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .fullscreen-diagram :global(svg) {
    max-width: calc(90vw - 80px);
    max-height: calc(90vh - 80px);
    width: auto;
    height: auto;
  }

  /* Thin strokes for all lines */
  .mermaid-svg :global(.edge-pattern-solid),
  .mermaid-svg :global(.flowchart-link),
  .mermaid-svg :global(.relation),
  .mermaid-svg :global(.transition),
  .mermaid-svg :global(line),
  .mermaid-svg :global(path.path),
  .mermaid-svg :global(.messageLine0),
  .mermaid-svg :global(.messageLine1) {
    stroke-width: 1px !important;
  }

  /* Subtle node borders */
  .mermaid-svg :global(.node rect),
  .mermaid-svg :global(.node circle),
  .mermaid-svg :global(.node ellipse),
  .mermaid-svg :global(.node polygon),
  .mermaid-svg :global(.node path),
  .mermaid-svg :global(.actor) {
    stroke-width: 1px !important;
  }

  /* Arrowheads */
  .mermaid-svg :global(marker path) {
    stroke-width: 1px !important;
  }

  /* State diagram specific */
  .mermaid-svg :global(.state-start),
  .mermaid-svg :global(.state-end) {
    stroke-width: 1px !important;
  }

  /* Sequence diagram lifelines */
  .mermaid-svg :global(.actor-line) {
    stroke-width: 1px !important;
    stroke-dasharray: 3, 3;
  }

  /* Softer text */
  .mermaid-svg :global(text),
  .mermaid-svg :global(.nodeLabel),
  .mermaid-svg :global(.edgeLabel),
  .mermaid-svg :global(.messageText),
  .mermaid-svg :global(.actor-text) {
    font-size: 12px !important;
    font-weight: 400 !important;
  }

  .mermaid-error {
    padding: 0.5rem;
    font-size: 0.75rem;
    color: hsl(var(--destructive));
  }

  .error-message {
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .error-source {
    margin-top: 0.5rem;
  }

  .error-source summary {
    cursor: pointer;
    opacity: 0.7;
  }

  .error-source pre {
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: hsl(var(--muted) / 0.3);
    overflow-x: auto;
    font-size: 0.7rem;
  }

  .mermaid-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60px;
  }

  .loading-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid hsl(var(--muted));
    border-top-color: hsl(var(--primary));
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mermaid-empty {
    padding: 1rem;
    text-align: center;
    color: hsl(var(--muted-foreground));
    font-size: 0.875rem;
  }
</style>
