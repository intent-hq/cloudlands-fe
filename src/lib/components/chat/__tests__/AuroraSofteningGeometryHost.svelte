<script lang="ts">
  import AuroraSofteningLayer from '../AuroraSofteningLayer.svelte';

  interface Props {
    dark?: boolean;
    width?: number;
    zoom?: number;
    longPrompt?: boolean;
  }

  let { dark = false, width = 720, zoom = 1, longPrompt = false }: Props = $props();
  const prompt = $derived(
    longPrompt
      ? 'A long multiline prompt stays sharp while the moving color behind it is progressively softened.\nSelection, caret, controls, and focus rings must remain clear.'
      : 'Typed prompt content stays sharp.',
  );
</script>

<div
  class:dark
  class="aurora-geometry-host relative overflow-hidden"
  data-testid="aurora-geometry-host"
  style="width: {width}px; height: 180px; zoom: {zoom};"
>
  <div class="aurora-simulation absolute inset-0" data-testid="aurora-simulation"></div>
  <AuroraSofteningLayer />
  <div class="prompt-layer absolute inset-x-0 bottom-0 z-20 p-3" data-testid="sharp-prompt-layer">
    <textarea data-testid="prompt-input" value={prompt} rows={longPrompt ? 3 : 1}></textarea>
    <button data-testid="send-control">Send</button>
  </div>
</div>

<style>
  .aurora-geometry-host {
    --background: 0 0% 100%;
    background: hsl(var(--background));
  }

  .aurora-geometry-host.dark {
    --background: 240 10% 4%;
  }

  .aurora-simulation {
    background:
      radial-gradient(circle at 24% 78%, #7c3aed 0 20%, transparent 52%),
      radial-gradient(circle at 78% 70%, #06b6d4 0 24%, transparent 56%),
      radial-gradient(circle at 52% 18%, #f472b6 0 18%, transparent 50%);
  }

  .prompt-layer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
  }

  textarea,
  button {
    min-width: 0;
    border: 1px solid currentColor;
    border-radius: 0.5rem;
    background: hsl(var(--background) / 0.82);
    color: hsl(var(--foreground, 240 10% 12%));
  }

  .dark textarea,
  .dark button {
    --foreground: 0 0% 98%;
  }

  textarea:focus,
  button:focus {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
</style>
