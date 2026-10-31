<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import TipTapEditor from '../TipTapEditor.svelte';
  import type {
    DockEvidenceInsertion,
    DockInsertionPart,
    EditorScreenReference,
  } from '$shared/dock-evidence';

  let {
    events = [],
    interim = [],
  }: {
    events?: readonly DockEvidenceInsertion[];
    interim?: readonly DockInsertionPart[];
  } = $props();
  const references: EditorScreenReference[] = [
    { id: 'first-mark', number: 1, label: 'Save' },
    { id: 'second-mark', number: 2, label: 'Cancel' },
  ];
  let root: HTMLElement;
  let selectionUpdates = $state(0);
  let endBaseline = $state<number | null>(null);
  let lastSelection = $state<ReturnType<typeof readCaret> | null>(null);
  let timeline = $state<Record<string, unknown>[]>([]);

  function readCaret() {
    const editor = root?.querySelector('[contenteditable="true"]');
    const selection = window.getSelection();
    const focus = selection?.focusNode;
    if (!editor || !selection || !focus || !editor.contains(focus)) return { inside: false };
    const prefix = document.createRange();
    prefix.selectNodeContents(editor);
    prefix.setEnd(focus, selection.focusOffset);
    const savedPrefix = prefix.cloneContents();
    const savedDocument = editor.cloneNode(true) as HTMLElement;
    for (const container of [savedPrefix, savedDocument]) {
      container.querySelectorAll('[data-screen-interim]').forEach((node) => node.remove());
    }
    return {
      inside: true,
      focused: document.activeElement === editor,
      collapsed: selection.isCollapsed,
      node: focus.nodeName,
      offset: selection.focusOffset,
      savedBefore: savedPrefix.textContent,
      savedText: savedDocument.textContent,
      logicalEnd: selection.isCollapsed && savedPrefix.textContent === savedDocument.textContent,
    };
  }

  function record(kind: string) {
    timeline = [
      ...timeline.slice(-79),
      {
        kind,
        at: performance.now(),
        selectionUpdates,
        endBaseline,
        ...readCaret(),
      },
    ];
  }

  function selectionAcknowledged() {
    // This callback acknowledges a model selection update; it exposes no PM position.
    untrack(() => {
      selectionUpdates += 1;
      lastSelection = readCaret();
      record('model-selection-update');
    });
  }

  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'End' || !(event.target instanceof Node) || !root.contains(event.target))
        return;
      endBaseline = selectionUpdates;
      record('End-keydown');
    };
    const selectionchange = () => {
      if (readCaret().inside) record('DOM-selectionchange');
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('selectionchange', selectionchange);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('selectionchange', selectionchange);
    };
  });

  let input = $state<TipTapEditor>();
  let value = $state('A');
  let committed = $state<string[]>([]);
  let composing = $state(false);
  let submissions = $state(0);
  let flushResult = $state<boolean | null>(null);
  const pending = $derived(events.filter((event) => !committed.includes(event.id)));

  function commit(id: string, text: string): void {
    if (pending[0]?.id !== id) return;
    value = text;
    committed = [...committed, id];
  }
</script>

<section
  bind:this={root}
  data-caret-state={JSON.stringify({ selectionUpdates, endBaseline, lastSelection })}
  data-caret-timeline={JSON.stringify(timeline)}
  data-reference-harness
  data-value={value}
  data-committed={JSON.stringify(committed)}
  data-composing={String(composing)}
  data-submissions={submissions}
  data-flush={String(flushResult)}
>
  <TipTapEditor
    bind:this={input}
    {value}
    screenReferences={references}
    screenInsertions={pending}
    screenInterim={interim}
    onSelectionChange={selectionAcknowledged}
    onUpdate={(text) => (value = text)}
    onScreenInsertionApplied={commit}
    onCompositionChange={(active) => (composing = active)}
    onSubmit={() => submissions++}
  />
  <Button onclick={() => (flushResult = input?.flushScreenEvidence() ?? false)}>
    Flush evidence
  </Button>
</section>
