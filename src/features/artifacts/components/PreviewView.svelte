<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { untrack } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { ArtifactDocument, ArtifactJson } from '$shared/types/visual-artifact';
  import { buildPreviewDocument, parsePreviewStateMessage } from '../preview';
  let {
    document,
    onChange,
    readonly,
  }: {
    document: ArtifactDocument;
    onChange: (document: ArtifactDocument) => void;
    readonly: boolean;
  } = $props();
  let iframe = $state<HTMLIFrameElement>();
  let srcdoc = $state('');
  let liveState = $state.raw<ArtifactJson | undefined>();
  let captured = $state(false);
  let resetKey = $state(0);
  const previewHtml = $derived(document.html ?? '');
  const artifactId = $derived(document.id);
  $effect(() => {
    const html = previewHtml;
    const id = artifactId;
    resetKey;
    untrack(() => {
      void id;
      srcdoc = buildPreviewDocument(html, document.previewState);
      liveState = undefined;
      captured = false;
    });
  });
  function receive(event: MessageEvent) {
    if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;
    const state = parsePreviewStateMessage(event.data);
    if (state !== undefined) {
      liveState = state;
      captured = false;
    }
  }
  function capture() {
    if (readonly || liveState === undefined) return;
    onChange({ ...document, previewState: structuredClone(liveState) });
    captured = true;
  }
</script>

<svelte:window onmessage={receive} />
<div class="artifact-toolbar">
  <Button variant="outline" onclick={() => (resetKey += 1)}>{m.artifact_editor_reset()}</Button>
  {#if !readonly}<Button variant="outline" onclick={capture} disabled={liveState === undefined}
      >{m.artifact_editor_capture()}</Button
    >{/if}
  <span class="artifact-hint" role="status"
    >{captured ? m.artifact_editor_captured() : m.artifact_editor_preview_hint()}</span
  >
</div>
{#key resetKey}
  <iframe
    bind:this={iframe}
    title={document.title}
    {srcdoc}
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    onload={() => iframe?.contentWindow?.postMessage({ type: 'intent-artifact:capture' }, '*')}
    class="artifact-preview"
  ></iframe>
{/key}
