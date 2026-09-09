<script lang="ts">
  type ToastGlyphVariant =
    'success' | 'error' | 'warning' | 'info' | 'loading' | 'update' | 'discussion';

  let { variant }: { variant: ToastGlyphVariant } = $props();
</script>

<span class="toast-glyph toast-glyph-{variant}" data-toast-glyph={variant} aria-hidden="true">
  {#if variant === 'success'}
    <svg viewBox="0 0 20 20"><path d="m5.5 10 3 3 6-6" /></svg>
  {:else if variant === 'error' || variant === 'info'}
    <span>{variant === 'error' ? '!' : 'i'}</span>
  {:else if variant === 'warning'}
    <svg viewBox="0 0 20 20">
      <path class="fill" d="M10 2.1 19 18H1L10 2.1Z" />
      <path d="M10 7v5m0 2.5v.1" />
    </svg>
  {:else if variant === 'loading'}
    <span class="loading-ring"></span>
  {:else if variant === 'update'}
    <svg viewBox="0 0 20 20"><path d="M10 2.5v10m-4-4 4 4 4-4M4 16h12" /></svg>
  {:else}
    <svg viewBox="0 0 20 20">
      <path d="M3 4.5h14v9H8l-4 3v-3H3v-9Zm4 4h.1m2.9 0h.1m2.9 0h.1" />
    </svg>
  {/if}
</span>

<style>
  .toast-glyph {
    display: inline-flex;
    width: 1.25rem;
    height: 1.25rem;
    flex: 0 0 1.25rem;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
  }

  svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .toast-glyph-success,
  .toast-glyph-error,
  .toast-glyph-info {
    border-radius: var(--radius-full);
    color: hsl(var(--toast-glyph-foreground));
  }

  .toast-glyph-success {
    --toast-glyph-foreground: var(--success-foreground);
    background: hsl(var(--success));
  }

  .toast-glyph-error {
    --toast-glyph-foreground: var(--danger-background);
    background: hsl(var(--danger));
  }

  .toast-glyph-info {
    --toast-glyph-foreground: var(--info-foreground);
    background: hsl(var(--info));
  }

  .toast-glyph-error span,
  .toast-glyph-info span {
    font-size: 0.8125rem;
    font-weight: 700;
    line-height: 1;
  }

  .toast-glyph-warning {
    --toast-warning-fill: color-mix(in srgb, hsl(var(--warning)) 65%, hsl(var(--foreground)));
    color: var(--toast-warning-fill);
  }

  .toast-glyph-warning .fill {
    fill: currentColor;
    stroke: none;
  }

  .toast-glyph-warning path:last-child {
    color: hsl(var(--warning-foreground));
  }

  .loading-ring {
    width: 1.125rem;
    height: 1.125rem;
    border: 1.5px solid hsl(var(--muted-foreground) / 0.3);
    border-top-color: hsl(var(--muted-foreground));
    border-radius: var(--radius-full);
    animation: toast-glyph-spin 900ms linear infinite;
  }

  .toast-glyph-update {
    color: hsl(var(--ring));
  }

  .toast-glyph-discussion {
    color: hsl(var(--info));
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-ring {
      animation: none;
    }
  }

  @keyframes toast-glyph-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
