<script lang="ts">
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
  import ChatCircleDotsIcon from 'phosphor-svelte/lib/ChatCircleDotsIcon';
  import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
  import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

  type ToastGlyphVariant =
    'success' | 'error' | 'warning' | 'info' | 'loading' | 'update' | 'discussion';

  let { variant }: { variant: ToastGlyphVariant } = $props();
</script>

<span class="toast-glyph toast-glyph-{variant}" data-toast-glyph={variant} aria-hidden="true">
  {#if variant === 'success'}
    <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
  {:else if variant === 'error'}
    <WarningCircleIcon size={16} weight="fill" aria-hidden="true" />
  {:else if variant === 'warning'}
    <WarningIcon size={16} weight="fill" aria-hidden="true" />
  {:else if variant === 'info'}
    <InfoIcon size={16} weight="fill" aria-hidden="true" />
  {:else if variant === 'loading'}
    <span class="loading-ring"></span>
  {:else if variant === 'update'}
    <DownloadSimpleIcon size={16} weight="bold" aria-hidden="true" />
  {:else}
    <ChatCircleDotsIcon size={16} aria-hidden="true" />
  {/if}
</span>

<style>
  .toast-glyph {
    display: inline-flex;
    width: 1rem;
    height: 1rem;
    flex: 0 0 1rem;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
  }

  .toast-glyph-success {
    color: hsl(var(--success));
  }

  .toast-glyph-error {
    color: hsl(var(--danger));
  }

  .toast-glyph-info {
    color: hsl(var(--info));
  }

  .toast-glyph-warning {
    color: hsl(var(--warning));
  }

  .loading-ring {
    width: 1rem;
    height: 1rem;
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
