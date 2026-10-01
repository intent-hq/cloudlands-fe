<script lang="ts">
  import { onMount } from 'svelte';
  import { BoundedNoteService, REGION_COUNT } from './bounded-note-service';
  import { EditingProof } from './editing-proof';

  // Test-only DOM harness, never routed into the product.
  let host: HTMLDivElement;
  let root: HTMLDivElement;
  let proof: EditingProof;
  let snapshot = $state('');
  let index = 0;
  const service = new BoundedNoteService();
  const publish = () => {
    if (proof) snapshot = JSON.stringify(proof.snapshot());
  };

  onMount(() => {
    proof = new EditingProof(service, host, publish);
    const save = () => proof.save();
    const offline = () => {
      service.failNextWrite = true;
    };
    root.addEventListener('proof-save', save);
    root.addEventListener('proof-offline', offline);
    void proof.show(0);
    return () => {
      root.removeEventListener('proof-save', save);
      root.removeEventListener('proof-offline', offline);
      proof.destroy();
    };
  });

  async function scroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement;
    const next = Math.min(REGION_COUNT - 1, Math.floor(target.scrollTop / 2400));
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
