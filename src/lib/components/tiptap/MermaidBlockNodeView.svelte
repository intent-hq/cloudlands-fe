<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import type { NodeViewProps } from '@tiptap/core';
  import hljs from 'highlight.js';
  import '$lib/styles/syntax-highlighting.css';
  import Fa from 'svelte-fa';
  import { faPencil, faExpand, faCode } from '@fortawesome/free-solid-svg-icons';
  import { slide } from '$lib/motion';
  import { tick } from 'svelte';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
  import DiagramPresentation from '$lib/components/diagrams/DiagramPresentation.svelte';
  import { serializeDiagramSvg } from '$lib/components/diagrams/diagram-export';
  import { toast } from '$lib/components/ui/toast';
  import MermaidRenderer, {
    type MermaidRenderState,
  } from '$lib/components/markdown/MermaidRenderer.svelte';
  import MediaLightbox from '$lib/components/ui/MediaLightbox.svelte';
  import ZoomPanViewport from '$lib/components/ui/ZoomPanViewport.svelte';
  import { m } from '$shared/paraglide/messages.js';

  // TipTap NodeViewProps
  let { node, selected, updateAttributes, editor }: NodeViewProps = $props();

  const isDarkTheme = selectIsDarkTheme();
  let isEditable = $derived(editor?.isEditable !== false);

  // Extract mermaid code from node attributes
  let savedCode = $derived<string>(node?.attrs?.code || '');

  // Exposed on the wrapper so tiptap-editor.css can keep failed renders in
  // the prose column instead of the wide diagram lane.
  let renderState = $state<MermaidRenderState>('pending');

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
  let fullscreenOpenerElement: HTMLElement | null = $state(null);
  let diagramContainerEl: HTMLDivElement | undefined = $state();
  let zoomPanViewport: ZoomPanViewport | undefined = $state();

  function openFullscreen(e: MouseEvent) {
    // Prevent the click from propagating to ProseMirror selection handling
    e.stopPropagation();
    e.preventDefault();
    try {
      if (!diagramContainerEl) throw new Error('Diagram container is unavailable');
      // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous DOM snapshot; this export helper does not fetch domain data
      fullscreenSvg = serializeDiagramSvg(diagramContainerEl);
    } catch {
      fullscreenSvg = '';
      toast.error(m.markdown_mermaid_renderFailed_error());
      return;
    }
    fullscreenOpenerElement = e.currentTarget as HTMLElement;
    // Blur any focused element (including TipTap editor) to avoid RangeError
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    isFullscreen = true;
  }

  function closeFullscreen() {
    isFullscreen = false;
    fullscreenSvg = '';
  }

  function handleFullscreenKeydown(e: KeyboardEvent) {
    // Zoom keys (+/-/0): forward to the viewport unless it already handled
    // the event itself (keydown bubbling up from inside the viewport)
    if (!e.defaultPrevented) zoomPanViewport?.handleKeydown(e);
  }

  // Whether code editor is visible
  let showCode = $state(false);
  let showSource = $state(false);

  function toggleSource(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    showSource = !showSource;
  }

  // The code being edited (live updates the diagram)
  let editCode = $state('');

  // Track the original code when editing started (for revert)
  let originalCode = $state('');

  // Whether we have unsaved changes
  let hasChanges = $derived(editCode !== originalCode);

  // The code to render in the diagram
  let displayCode = $derived(
    showCode ? (isBase64(savedCode) ? encodeBase64(editCode) : editCode) : savedCode,
  );

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
  let textareaEl = $state<HTMLTextAreaElement>();

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
</script>

<NodeViewWrapper class="mermaid-block-wrapper" data-drag-handle data-render-state={renderState}>
  <DiagramPresentation kind="mermaid" selected={Boolean(selected)} actionsInTopMargin>
    {#snippet actions()}
      {#if !showCode}
        {#if isEditable}
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            iconOnly
            onclick={openCodeView}
            title={m.tiptap_mermaidBlock_editCode_tooltip()}
            aria-label={m.tiptap_mermaidBlock_editCode_tooltip()}
          >
            <Fa icon={faPencil} size="xs" />
          </Button>
        {:else if renderState === 'rendered'}
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            iconOnly
            onclick={toggleSource}
            aria-pressed={showSource}
            title={m.markdown_mermaid_viewSource_label()}
            aria-label={m.markdown_mermaid_viewSource_label()}
          >
            <Fa icon={faCode} size="xs" />
          </Button>
        {/if}
        <Button
          type="button"
          variant="ghost"
          size="icon-compact"
          iconOnly
          onclick={openFullscreen}
          title={m.tiptap_mermaidBlock_fullscreen_tooltip()}
          aria-label={m.tiptap_mermaidBlock_fullscreen_tooltip()}
        >
          <Fa icon={faExpand} size="xs" />
        </Button>
      {/if}
    {/snippet}

    <div class="mermaid-note-content" class:dark-mode={$isDarkTheme}>
      <div bind:this={diagramContainerEl}>
        <MermaidRenderer
          code={displayCode}
          showExpandButton={false}
          showSourceButton={false}
          showSource={showSource && !isEditable}
          onRenderStateChange={(state) => (renderState = state)}
        />
      </div>

      {#if showCode}
        <div
          class="mermaid-code-section"
          contenteditable="false"
          transition:slide={{ axis: 'y', tier: 'moderate' }}
        >
          <div class="code-editor-wrapper">
            <pre class="code-highlight hljs" aria-hidden="true">{@html highlightedCode + '\n'}</pre>
            <Textarea
              bind:ref={textareaEl}
              class="code-textarea"
              value={editCode}
              oninput={handleCodeInput}
              onkeydown={handleKeyDown}
              spellcheck="false"
              autocorrect="off"
              autocapitalize="off"
            ></Textarea>
          </div>
          <div class="edit-actions">
            {#if hasChanges}
              <Button type="button" variant="ghost" class="action-btn" onclick={cancelChanges}
                >{m.tiptap_mermaidBlock_cancel_label()}</Button
              >
              <Button type="button" class="action-btn primary" onclick={saveChanges}
                >{m.tiptap_mermaidBlock_save_label()}</Button
              >
            {:else}
              <Button type="button" variant="ghost" class="action-btn" onclick={closeCodeView}
                >{m.tiptap_mermaidBlock_close_label()}</Button
              >
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </DiagramPresentation>
</NodeViewWrapper>

<MediaLightbox
  bind:open={isFullscreen}
  ariaLabel={m.tiptap_mermaidBlock_fullscreenView_ariaLabel()}
  closeLabel={m.tiptap_mermaidBlock_closeFullscreen_ariaLabel()}
  onClose={closeFullscreen}
  openerElement={fullscreenOpenerElement}
  onKeydown={handleFullscreenKeydown}
>
  <div
    class="h-[90vh] w-[90vw] overflow-hidden rounded-lg bg-background shadow-2xl"
    data-media-lightbox-content
  >
    <ZoomPanViewport bind:this={zoomPanViewport}>
      <div class="fullscreen-diagram">{@html fullscreenSvg}</div>
    </ZoomPanViewport>
  </div>
</MediaLightbox>

<style>
  .mermaid-block-wrapper {
    display: block;
  }

  .fullscreen-diagram {
    padding: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
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
    to {
      transform: rotate(360deg);
    }
  }

  .mermaid-error {
    font-size: 0.75rem;
    color: hsl(var(--danger));
  }

  /* Syntax highlighting for dark mode */
  .dark-mode .code-highlight {
    color: #d4d4d4;
  }

  .dark-mode :global(.hljs-keyword) {
    color: #569cd6;
  }
  .dark-mode :global(.hljs-string) {
    color: #ce9178;
  }
  .dark-mode :global(.hljs-number) {
    color: #b5cea8;
  }
  .dark-mode :global(.hljs-comment) {
    color: #6a9955;
  }
  .dark-mode :global(.hljs-section) {
    color: #569cd6;
  }
  .dark-mode :global(.hljs-bullet) {
    color: #d7ba7d;
  }
  .dark-mode :global(.hljs-emphasis) {
    font-style: italic;
  }
  .dark-mode :global(.hljs-strong) {
    font-weight: bold;
  }

  /* Syntax highlighting for light mode */
  .mermaid-note-content:not(.dark-mode) .code-highlight {
    color: #1f2937;
  }

  .mermaid-note-content:not(.dark-mode) :global(.hljs-keyword) {
    color: #0000ff;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-string) {
    color: #a31515;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-number) {
    color: #098658;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-comment) {
    color: #008000;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-section) {
    color: #0000ff;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-bullet) {
    color: #795e26;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-emphasis) {
    font-style: italic;
  }
  .mermaid-note-content:not(.dark-mode) :global(.hljs-strong) {
    font-weight: bold;
  }
</style>
