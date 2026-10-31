<script lang="ts">
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
    onUpdate={(text) => (value = text)}
    onScreenInsertionApplied={commit}
    onCompositionChange={(active) => (composing = active)}
    onSubmit={() => submissions++}
  />
  <Button onclick={() => (flushResult = input?.flushScreenEvidence() ?? false)}>
    Flush evidence
  </Button>
</section>
