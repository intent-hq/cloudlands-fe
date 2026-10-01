<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { Plugin } from '@tiptap/pm/state';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { DocumentSession } from './document-session';
  import { SourceJournal, fixture } from './source-journal';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  let { oracle = false, small = false }: { oracle?: boolean; small?: boolean } = $props();
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
    const service = new SourceJournal(fixture, small ? 2 : 10000);
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
      void processMarkdownToHTML(fixture(0) + fixture(1)).then((content) => {
        if (disposed) return;
        native = new Editor({ ...config, content, onUpdate: () => {} });
        Object.assign(root, { native });
        native.view.focus();
      });
    } else {
      proof = new DocumentSession(service, host, publish);
      void proof.show(0);
    }
    Object.assign(root, {
      proof: proof ?? null,
      native: native ?? null,
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
