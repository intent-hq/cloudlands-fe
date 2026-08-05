<script lang="ts">
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import type { NodeViewProps } from '@tiptap/core';
  import hljs from 'highlight.js';
  import '$lib/styles/syntax-highlighting.css';
  import Fa from 'svelte-fa';
  import {
  faPencil,
  faExpand,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import { tick } from 'svelte';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { m } from '$shared/paraglide/messages.js';

  // TipTap NodeViewProps
  let { node, selected, updateAttributes }: NodeViewProps = $props();

  const isDarkTheme = selectIsDarkTheme();

  // Extract mermaid code from node attributes
  let savedCode = $derived<string>(node?.attrs?.code || '');

  // Decode base64 for display
  function decodeBase64(str: string): string {
    try {
      if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
        return decodeURIComponent(escape(atob(str)));
      }
      return str;
    } catch {
      return str;
    }
  }

  // Encode to base64 for storage
  function encodeBase64(str: string): string {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return str;
    }
  }

  // Check if the code is base64 encoded
  function isBase64(str: string): boolean {
    try {
      return /^[A-Za-z0-9+/=]+$/.test(str.trim()) && str.trim().length > 0;
    } catch {
      return false;
    }
  }

  // Fullscreen state
  let isFullscreen = $state(false);
  let fullscreenSvg = $state('');
  let fullscreenDialogElement: HTMLDivElement | undefined = $state();
  let diagramContainerEl: HTMLDivElement | undefined = $state();
  let zoomPanViewport: ZoomPanViewport | undefined = $state();

  function openFullscreen(e: MouseEvent) {
    // Prevent the click from propagating to ProseMirror selection handling
    e.stopPropagation();
    e.preventDefault();
    // Blur any focused element (including TipTap editor) to avoid RangeError
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // Grab the rendered SVG from the diagram container
    const svgEl = diagramContainerEl?.querySelector('.mermaid-svg svg, .mermaid-renderer svg');
    if (svgEl) {
      fullscreenSvg = svgEl.outerHTML;
    }
    isFullscreen = true;
  }

  function closeFullscreen() {
    isFullscreen = false;
    fullscreenSvg = '';
  }

  function handleFullscreenBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      closeFullscreen();
    }
  }

  function handleFullscreenKeydown(e: KeyboardEvent) {
    // Zoom keys (+/-/0): forward to the viewport unless it already handled
    // the event itself (keydown bubbling up from inside the viewport)
    if (!e.defaultPrevented && zoomPanViewport?.handleKeydown(e)) return;
    if (e.key === 'Escape') closeFullscreen();
  }

  // Whether code editor is visible
  let showCode = $state(false);

  // The code being edited (live updates the diagram)
  let editCode = $state('');

  // Track the original code when editing started (for revert)
  let originalCode = $state('');

  // Whether we have unsaved changes
  let hasChanges = $derived(editCode !== originalCode);

  // The code to render in the diagram
  let displayCode = $derived(showCode ? (isBase64(savedCode) ? encodeBase64(editCode) : editCode) : savedCode);

  // Syntax highlighted HTML
  let highlightedCode = $derived.by(() => {
    try {
      // Use auto-detection for best highlighting
      return hljs.highlightAuto(editCode).value;
    } catch {
      return editCode.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  });

  // Debounce timer for auto-saving
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let textareaEl: HTMLTextAreaElement;

  async function openCodeView(e: MouseEvent) {
    // Prevent the click from selecting text or triggering bubble menu
    e.stopPropagation();
    e.preventDefault();
    // Blur any focused element (including TipTap editor) to hide bubble menu
    (document.activeElement as HTMLElement)?.blur();

    const decoded = decodeBase64(savedCode);
    editCode = decoded;
    originalCode = decoded;
    showCode = true;

    // Focus the textarea after DOM updates
    await tick();
    textareaEl?.focus();
  }

  function closeCodeView() {
    showCode = false;
  }

  function handleCodeInput(e: Event) {
    editCode = (e.target as HTMLTextAreaElement).value;
    if (saveTimeout) clearTimeout(saveTimeout);
    // Auto-save after 1 second of inactivity (doesn't close editor)
    saveTimeout = setTimeout(() => autoSave(), 1000);
  }

  // Auto-save: persist changes without closing the editor
  // Does NOT update originalCode so Cancel can still revert to initial state
  function autoSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    const newCode = isBase64(savedCode) ? encodeBase64(editCode) : editCode;
    updateAttributes({ code: newCode });
  }

  // Explicit save: persist changes and close the editor
  function saveChanges() {
    autoSave();
    originalCode = editCode; // Now there are no unsaved changes
    showCode = false;
  }

  function cancelChanges() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    editCode = originalCode;
    const revertCode = isBase64(savedCode) ? encodeBase64(originalCode) : originalCode;
    updateAttributes({ code: revertCode });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (hasChanges) {
        cancelChanges();
      }
      showCode = false;
    }
  }

  // Escape layer: registered only while fullscreen so stacked overlays
  // dismiss one at a time in LIFO order
  $effect(() => {
    if (!isFullscreen) return;
    return pushEscapeLayer(() => closeFullscreen());
  });

  // Auto-focus fullscreen dialog for accessibility
  $effect(() => {
    if (isFullscreen && fullscreenDialogElement) {
      try {
        fullscreenDialogElement.focus();
      } catch {
        // Defensive: ignore focus errors from ProseMirror selection reconciliation
      }
    }
  });
</script>

<NodeViewWrapper class="mermaid-block-wrapper" data-drag-handle>
  <div class="mermaid-block" class:selected class:dark-mode={$isDarkTheme}>
    <!-- Diagram -->
    <div bind:this={diagramContainerEl}>
      <MermaidRenderer code={displayCode} showExpandButton={false} />
    </div>

    <!-- Code editor -->
    {#if showCode}
      <div class="mermaid-code-section" contenteditable="false" transition:slide={{ axis: 'y', duration: 200 }}>
        <div class="code-editor-wrapper">
          <pre class="code-highlight hljs" aria-hidden="true">{@html highlightedCode + '\n'}</pre>
          <textarea
            bind:this={textareaEl}
            class="code-textarea"
            value={editCode}
            oninput={handleCodeInput}
            onkeydown={handleKeyDown}
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
          ></textarea>
        </div>
        <div class="edit-actions">
          {#if hasChanges}
            <button type="button" class="action-btn" onclick={cancelChanges}>{m.tiptap_mermaidBlock_cancel_label()}</button>
            <button type="button" class="action-btn primary" onclick={saveChanges}>{m.tiptap_mermaidBlock_save_label()}</button>
          {:else}
            <button type="button" class="action-btn" onclick={closeCodeView}>{m.tiptap_mermaidBlock_close_label()}</button>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Action buttons (edit + expand) -->
    {#if !showCode}
      <div class="action-btns">
        <button type="button" class="hover-btn" onclick={openCodeView} title={m.tiptap_mermaidBlock_editCode_tooltip()}>
          <Fa icon={faPencil} size="xs" />
        </button>
        <button type="button" class="hover-btn" onclick={openFullscreen} title={m.tiptap_mermaidBlock_fullscreen_tooltip()}>
          <Fa icon={faExpand} size="xs" />
        </button>
      </div>
    {/if}
  </div>
</NodeViewWrapper>

<!-- Fullscreen overlay -->
{#if isFullscreen}
  <div
    class="fullscreen-overlay"
    onclick={handleFullscreenBackdropClick}
    onkeydown={handleFullscreenKeydown}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label={m.tiptap_mermaidBlock_fullscreenView_ariaLabel()}
    bind:this={fullscreenDialogElement}
  >
    <div class="fullscreen-content">
      <button
        class="close-button"
        onclick={closeFullscreen}
        title={m.tiptap_mermaidBlock_closeFullscreen_tooltip()}
        aria-label={m.tiptap_mermaidBlock_closeFullscreen_ariaLabel()}
      >
        <Fa icon={faTimes} size="sm" />
      </button>
      <!-- Fresh component per open, so zoom/pan state resets each time -->
      <div class="fullscreen-diagram">
        <ZoomPanViewport bind:this={zoomPanViewport}>
          {@html fullscreenSvg}
        </ZoomPanViewport>
      </div>
    </div>
  </div>
{/if}

<style>
  .mermaid-block-wrapper {
    display: block;
  }

  .mermaid-block {
    position: relative;
  }

  .mermaid-block:hover .action-btns {
    opacity: 1;
  }

  .action-btns {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    gap: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .hover-btn {
    padding: 4px;
    background: hsl(var(--muted) / 0.8);
    border: none;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: color 0.15s;
  }

  .hover-btn:hover {
    color: hsl(var(--foreground));
  }

  /* Fullscreen overlay */
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
    width: 90vw;
    height: 90vh;
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

  .fullscreen-diagram {
    flex: 1;
    min-height: 0;
    padding: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .fullscreen-diagram :global(svg) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
  }

  /* Code section */
  .mermaid-code-section {
    margin-top: 0.5rem;
    background: hsl(var(--sidebar));
    padding: 0.5rem;
    overflow: hidden;
  }

  .code-editor-wrapper {
    position: relative;
    font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
  }

  .code-highlight {
    margin: 0;
    padding: 0.5rem;
    white-space: pre-wrap;
    word-wrap: break-word;
    pointer-events: none;
    background: transparent;
  }

  .code-textarea {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0.5rem;
    font: inherit;
    line-height: inherit;
    color: transparent;
    background: transparent;
    border: none;
    resize: none;
    caret-color: hsl(var(--foreground));
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow: hidden;
  }

  .code-textarea:focus {
    outline: none;
  }

  .edit-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .action-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
    background: transparent;
    border: none;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: color 0.15s;
  }

  .action-btn:hover {
    color: hsl(var(--foreground));
  }

  .action-btn.primary {
    color: hsl(var(--primary));
  }

  .action-btn.primary:hover {
    color: hsl(var(--primary) / 0.8);
  }

  .mermaid-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 40px;
  }

  .loading-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid hsl(var(--muted));
    border-top-color: hsl(var(--primary));
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mermaid-error {
    font-size: 0.75rem;
    color: hsl(var(--destructive));
  }

  /* Syntax highlighting for dark mode */
  .dark-mode .code-highlight {
    color: #d4d4d4;
  }

  .dark-mode :global(.hljs-keyword) { color: #569cd6; }
  .dark-mode :global(.hljs-string) { color: #ce9178; }
  .dark-mode :global(.hljs-number) { color: #b5cea8; }
  .dark-mode :global(.hljs-comment) { color: #6a9955; }
  .dark-mode :global(.hljs-section) { color: #569cd6; }
  .dark-mode :global(.hljs-bullet) { color: #d7ba7d; }
  .dark-mode :global(.hljs-emphasis) { font-style: italic; }
  .dark-mode :global(.hljs-strong) { font-weight: bold; }

  /* Syntax highlighting for light mode */
  .mermaid-block:not(.dark-mode) .code-highlight {
    color: #1f2937;
  }

  .mermaid-block:not(.dark-mode) :global(.hljs-keyword) { color: #0000ff; }
  .mermaid-block:not(.dark-mode) :global(.hljs-string) { color: #a31515; }
  .mermaid-block:not(.dark-mode) :global(.hljs-number) { color: #098658; }
  .mermaid-block:not(.dark-mode) :global(.hljs-comment) { color: #008000; }
  .mermaid-block:not(.dark-mode) :global(.hljs-section) { color: #0000ff; }
  .mermaid-block:not(.dark-mode) :global(.hljs-bullet) { color: #795e26; }
  .mermaid-block:not(.dark-mode) :global(.hljs-emphasis) { font-style: italic; }
  .mermaid-block:not(.dark-mode) :global(.hljs-strong) { font-weight: bold; }
</style>
