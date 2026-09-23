<script lang="ts">
  import type { MermaidRenderState } from '$lib/components/markdown/MermaidRenderer.svelte';

  let {
    code,
    onRenderStateChange,
  }: {
    code: string;
    onRenderStateChange?: (state: MermaidRenderState) => void;
  } = $props();

  // Test-only sentinels model renderer outcomes without parsing Mermaid.
  let state = $derived<MermaidRenderState>(
    !code.trim()
      ? 'empty'
      : code === 'pending'
        ? 'pending'
        : code === 'error'
          ? 'error'
          : 'rendered',
  );
  $effect(() => onRenderStateChange?.(state));
</script>

<div class="mermaid-renderer" data-render-settled={state === 'rendered'}>
  <span aria-hidden="true"><svg width="16" height="16"><circle r="4" /></svg></span>
  {#if state === 'rendered' || state === 'pending'}
    <div class="mermaid-svg">
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="60" viewBox="0 0 160 60">
        <rect x="0" y="10" width="50" height="40" fill="none" stroke="currentColor" />
        <text x="5" y="35">Start</text>
        <path d="M50 30H100" stroke="currentColor" />
        <rect x="100" y="10" width="60" height="40" fill="none" stroke="currentColor" />
        <text x="105" y="35">Finish</text>
      </svg>
    </div>
  {/if}
</div>
