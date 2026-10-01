<script lang="ts">
  import { onMount } from 'svelte';
  import type { editor as MonacoEditor } from 'monaco-editor';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$shared/paraglide/messages.js';
  import { payloadDocument, payloadSupportsRichView } from './traffic-view';
  import { initializePayloadMonaco } from './payload-monaco';

  let { text, label }: { text: string; label: string } = $props();
  const content = $derived(payloadDocument(text));
  const richView = $derived(payloadSupportsRichView(content.text));
  let host: HTMLDivElement;
  let editor = $state.raw<MonacoEditor.IStandaloneCodeEditor | null>(null);
  let failed = $state(false);
  let update: (() => void) | undefined;

  $effect(() => {
    // Track both content and readiness: replies can arrive while Monaco is loading.
    void content;
    void richView;
    void label;
    if (editor) update?.();
  });

  onMount(() => {
    let disposed = false;
    let model: MonacoEditor.ITextModel | undefined;
    let instance: MonacoEditor.IStandaloneCodeEditor | undefined;
    let themeObserver: MutationObserver | undefined;
    function release() {
      themeObserver?.disconnect();
      instance?.dispose();
      model?.dispose();
      themeObserver = undefined;
      instance = undefined;
      model = undefined;
      update = undefined;
    }
    async function mount() {
      try {
        const { monaco, defineMonacoThemes, getActiveMonacoThemeName } =
          await initializePayloadMonaco();
        if (disposed) return;
        defineMonacoThemes();
        const theme = () =>
          getActiveMonacoThemeName(document.documentElement.classList.contains('dark'));
        let modelRichView = richView;
        model = monaco.editor.createModel(content.text, richView ? content.language : 'plaintext');
        instance = monaco.editor.create(host, {
          model,
          theme: theme(),
          ariaLabel: label,
          readOnly: true,
          domReadOnly: true,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'off',
          lineDecorationsWidth: 16,
          glyphMargin: false,
          scrollBeyondLastLine: false,
          folding: richView,
          largeFileOptimizations: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'always',
          renderLineHighlight: 'none',
          renderValidationDecorations: 'off',
          wordWrap: 'off',
          contextmenu: false,
          find: { addExtraSpaceOnTop: true, seedSearchStringFromSelection: 'never' },
          padding: { top: 8, bottom: 8 },
        });
        update = () => {
          const language = richView ? content.language : 'plaintext';
          if (modelRichView !== richView) {
            // Monaco fixes its large-file capability at model construction time.
            // Replace on boundary crossings so safeguards and rich features recover.
            const previous = model!;
            model = monaco.editor.createModel(content.text, language);
            instance!.setModel(model);
            previous.dispose();
            modelRichView = richView;
          } else {
            if (model!.getValue() !== content.text) model!.setValue(content.text);
            if (model!.getLanguageId() !== language) {
              monaco.editor.setModelLanguage(model!, language);
            }
          }
          instance!.updateOptions({ ariaLabel: label, folding: richView });
        };
        themeObserver = new MutationObserver(() => instance?.updateOptions({ theme: theme() }));
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        });
        editor = instance;
      } catch {
        release();
        if (!disposed) failed = true;
      }
    }
    void mount();
    return () => {
      disposed = true;
      release();
      editor = null;
    };
  });

  function run(action: string) {
    editor?.focus();
    void editor?.getAction(action)?.run();
  }
</script>

<section class="viewer" data-payload-viewer aria-label={label}>
  <div class="viewer-toolbar" data-payload-toolbar>
    <div class="controls">
      <Button size="compact" variant="ghost" disabled={!editor} onclick={() => run('actions.find')}>
        {m.devConsole_payload_search_label()}
      </Button>
      <Button
        size="compact"
        variant="ghost"
        disabled={!editor || !richView}
        onclick={() => run('editor.foldAll')}
      >
        {m.devConsole_payload_collapse_label()}
      </Button>
      <Button
        size="compact"
        variant="ghost"
        disabled={!editor || !richView}
        onclick={() => run('editor.unfoldAll')}
      >
        {m.devConsole_payload_expand_label()}
      </Button>
    </div>
    {#if !richView}<span class="limitation" role="status"
        >{m.devConsole_payload_large_description()}</span
      >{/if}
    {#if failed}<span role="status">{m.devConsole_payload_load_error()}</span>{/if}
  </div>
  {#if !editor}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Fallback payload must be keyboard reachable.) -->
    <pre tabindex="0">{content.text}</pre>
  {/if}
  <div class="editor" class:pending={!editor} bind:this={host}></div>
</section>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    flex-shrink: 0;
    gap: 2px;
    padding: 2px;
  }
  .viewer-toolbar {
    flex-shrink: 0;
  }
  .editor {
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .limitation {
    display: block;
    padding: 2px 8px;
    color: var(--muted-foreground);
  }
  .pending {
    position: absolute;
    visibility: hidden;
  }
  pre {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 8px 12px;
    user-select: text;
  }
  pre:focus-visible {
    outline: 2px solid var(--ring);
  }
</style>
