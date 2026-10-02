<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faArrowRight } from '@fortawesome/free-solid-svg-icons';
  import * as m from '$shared/paraglide/messages.js';
  let {
    kind,
    pulse = 0,
    onStop,
    onOpenAgent,
    onInteractive,
  }: {
    kind: 'glow' | 'controls';
    pulse?: number;
    onStop: () => void;
    onOpenAgent: () => void;
    onInteractive: (interactive: boolean) => void;
  } = $props();

  function hitTest(event: MouseEvent) {
    onInteractive(event.target instanceof Element && !!event.target.closest('button'));
  }
</script>

<svelte:window onmousemove={hitTest} onblur={() => onInteractive(false)} />
<svelte:document onmouseleave={() => onInteractive(false)} />

{#if kind === 'glow'}
  <div class="glow" aria-hidden="true"></div>
  {#key pulse}
    {#if pulse > 0}<div class="glow pulse" aria-hidden="true"></div>{/if}
  {/key}
{:else}
  <div class="controls">
    <Button variant="primary" size="sm" onclick={onStop}>{m.desktop_overlay_stop_label()}</Button>
    <span class="type-caption">{m.desktop_overlay_status()}</span>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={m.desktop_overlay_openAgent_ariaLabel()}
      onclick={onOpenAgent}
    >
      <Fa icon={faArrowRight} />
    </Button>
  </div>
{/if}

<style>
  .glow {
    position: fixed;
    inset: 0;
    pointer-events: none;
    border: 2px solid hsl(var(--primary) / 0.8);
    box-shadow: inset 0 0 22px 5px hsl(var(--primary) / 0.45);
  }
  .pulse {
    box-shadow: inset 0 0 44px 12px hsl(var(--primary) / 0.85);
    animation: screenshot-pulse var(--spring-slow) ease-out both;
  }
  @keyframes screenshot-pulse {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  .controls {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0 0.5rem;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    border: 1px solid hsl(var(--primary));
    border-radius: var(--radius-medium);
  }
  .controls span {
    text-align: center;
  }
</style>
