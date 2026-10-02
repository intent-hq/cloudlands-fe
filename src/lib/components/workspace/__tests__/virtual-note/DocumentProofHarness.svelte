<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { DOMParser } from '@tiptap/pm/model';
  import { Plugin } from '@tiptap/pm/state';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { DocumentSession } from './document-session';
  import { SourceJournal, fixture } from './source-journal';
  import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
  let {
    oracle = false,
    small = false,
    paragraphRepeats = 0,
    sourceOverride,
  }: {
    oracle?: boolean;
    small?: boolean;
    paragraphRepeats?: number;
    sourceOverride?: string;
  } = $props();
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let proof: DocumentSession;
  let native: Editor;
  let snapshot = $state('');
  let index = 0;
  const publish = () => {
    if (proof) snapshot = JSON.stringify(proof.snapshot());
  };
  onMount(() => {
    let disposed = false;
    // Deliberately unbounded MOCK BACKING fixture, separate from renderer windows.
    const paragraphSource =
      sourceOverride ?? 'repeated café 🌍 text repeated. '.repeat(paragraphRepeats);
    const custom = sourceOverride !== undefined || paragraphRepeats > 0;
    const paragraph = () => paragraphSource;
    const service = new SourceJournal(custom ? paragraph : fixture, custom ? 1 : small ? 2 : 10000);
    if (oracle) {
      const config = createEditorConfig({
        element: host,
        content: '',
        editable: true,
        useMarkdown: true,
        enableComments: false,
        enableMentions: false,
        onUpdate: () => {},
      });
      void processMarkdownToHTML(custom ? paragraph() : fixture(0) + fixture(1)).then((content) => {
        if (disposed) return;
        native = new Editor({ ...config, content, onUpdate: () => {} });
        Object.assign(root, { native });
        native.view.focus();
      });
    } else {
      proof = new DocumentSession(service, host, publish);
      void proof.show(0).catch((error) => {
        proof.error = String(error);
        publish();
      });
    }
    Object.assign(root, {
      proof: proof ?? null,
      native: native ?? null,
      mockBackingFixtureBytes: new TextEncoder().encode(paragraphSource).byteLength,
      parseSource: async (source: string, renderMath = false) => {
        const html = await processMarkdownToHTML(source, { renderMath });
        const element = document.createElement('div');
        element.innerHTML = html;
        const editor = proof?.editor ?? native;
        return { html, doc: DOMParser.fromSchema(editor.schema).parse(element).toJSON() };
      },
      reopenProof: async (source: string) => {
        proof.destroy();
        proof = new DocumentSession(new SourceJournal(() => source, 1), host, publish);
        Object.assign(root, { proof });
        await proof.show(0);
      },
      nativeMarkdown: (preserveAnchors = true) =>
        processHTMLToMarkdown(native.getHTML(), { preserveAnchors }),
      serializeHTML: (html: string, preserveAnchors = true) =>
        processHTMLToMarkdown(html, { preserveAnchors }),
      reloadNative: async (source: string) => {
        const content = await processMarkdownToHTML(source);
        native.destroy();
        native = new Editor(
          createEditorConfig({
            element: host,
            content,
            editable: true,
            useMarkdown: true,
            enableComments: false,
            enableMentions: false,
            onUpdate: () => {},
          }),
        );
        Object.assign(root, { native });
      },
      appendProbe: () => {
        const editor = proof.editor!;
        editor.registerPlugin(
          new Plugin({
            appendTransaction(transactions, _old, state) {
              if (transactions.some((tr) => tr.getMeta('proof-append')))
                return state.tr.insertText('APPENDED', 2);
              return null;
            },
          }),
        );
        editor.view.dispatch(editor.state.tr.insertText('ROOT', 1).setMeta('proof-append', true));
      },
    });
    const save = () => proof.save();
    root.addEventListener('proof-save', save);
    return () => {
      disposed = true;
      root.removeEventListener('proof-save', save);
      proof?.destroy();
      native?.destroy();
    };
  });
  async function scroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement;
    const next = Math.min(9999, Math.floor(target.scrollTop / 2400));
    if (next === index) return;
    if (await proof.show(next)) index = next;
    else target.scrollTop = index * 2400;
  }
</script>

<div data-testid="proof" bind:this={root}>
  <div
    data-testid="scroll"
    onscroll={scroll}
    style="height: 540px; overflow: auto; position: relative;"
  >
    <div style="height: 24000000px; pointer-events: none;"></div>
    <div
      style="position: sticky; bottom: 0; height: 520px; overflow: auto; background: var(--background);"
    >
      <div bind:this={host} data-testid="editor-host"></div>
    </div>
  </div>
  <output data-testid="snapshot">{snapshot}</output>
</div>

<style>
  :global(.proof-table-projection [data-proof-cell-fragment]) {
    padding-top: calc(0.5rem + var(--proof-cell-before));
    padding-bottom: calc(0.5rem + var(--proof-cell-after));
  }
  :global(.proof-table-projection table) {
    width: var(--proof-table-width) !important;
    min-width: 0 !important;
    table-layout: fixed !important;
  }
  :global(.proof-table-projection col) {
    width: var(--proof-column-width) !important;
  }
  :global(.proof-table-projection th),
  :global(.proof-table-projection td) {
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  :global(.proof-synthetic-list-item > div > [contenteditable='false']) {
    display: none;
  }
</style>
