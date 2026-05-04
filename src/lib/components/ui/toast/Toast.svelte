<script lang="ts">
  import { Toaster as Sonner } from 'svelte-sonner';
  import { selectIsDarkTheme } from '$lib/store/slices/theme/theme-selectors';

  const isDarkTheme = selectIsDarkTheme();
</script>

<Sonner
  theme={$isDarkTheme ? 'dark' : 'light'}
  class="toaster group"
  toastOptions={{
    classes: {
      toast:
        'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-lg',
      description: 'group-[.toast]:text-subtle text-sm',
      actionButton:
        'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted group-[.toast]:px-4 group-[.toast]:py-2 group-[.toast]:text-sm group-[.toast]:font-semibold group-[.toast]:transition-colors',
      cancelButton:
        'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted group-[.toast]:px-4 group-[.toast]:py-2 group-[.toast]:text-sm group-[.toast]:font-semibold',
      action: 'text-sm font-semibold',
    },
  }}
  position="bottom-left"
  closeButton
  duration={10000}
  gap={8}
/>

<style>
  :global([data-sonner-toast]) {
    background: hsl(var(--card)) !important;
    color: hsl(var(--foreground)) !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 0 !important;
    backdrop-filter: blur(8px);
    min-width: 360px;
    padding: 1rem 1.25rem;
    align-items: flex-start !important;
    box-shadow:
      0 10px 15px -3px rgb(0 0 0 / 0.08),
      0 4px 6px -4px rgb(0 0 0 / 0.08);
  }

  :global([data-sonner-toast] [data-icon]) {
    margin-top: 2px;
  }

  :global(.dark [data-sonner-toast]) {
    box-shadow:
      0 10px 15px -3px rgb(0 0 0 / 0.25),
      0 4px 6px -4px rgb(0 0 0 / 0.25);
  }

  :global([data-sonner-toast] [data-description]) {
    color: hsl(var(--muted-foreground)) !important;
    font-size: 0.875rem;
    margin-top: 0.25rem;
  }

  /* Action buttons using CSS variables */
  :global([data-sonner-toast] button[data-button]) {
    font-size: 0.875rem !important;
    font-weight: 600 !important;
    padding: 0.5rem 1rem !important;
    border-radius: 0 !important;
    transition: all 0.15s ease !important;
    border: 1px solid hsl(var(--border)) !important;
    background: transparent !important;
    color: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast] button[data-button]:hover) {
    background: hsl(var(--muted)) !important;
    border-color: hsl(var(--border)) !important;
  }

  :global([data-sonner-toast] [data-icon]) {
    width: 1.25rem;
    height: 1.25rem;
  }

  /* Close button styling */
  :global([data-sonner-toast] [data-close-button]) {
    color: hsl(var(--muted-foreground)) !important;
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--card)) !important;
  }

  :global(.sonner-loading-bar) {
    background-color: hsl(var(--muted-foreground) / 0.3);
  }

  /* Warning/undo toasts — inverted (foreground bg, background text) */
  :global([data-sonner-toast][data-type='warning']) {
    background: hsl(var(--foreground)) !important;
    color: hsl(var(--background)) !important;
    border-color: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast][data-type='warning'] [data-description]) {
    color: hsl(var(--background) / 0.7) !important;
  }

  :global([data-sonner-toast][data-type='warning'] [data-close-button]) {
    color: hsl(var(--background)) !important;
    border-color: hsl(var(--background) / 0.2) !important;
    background: hsl(var(--foreground)) !important;
  }

  :global([data-sonner-toast][data-type='warning'] button[data-button]) {
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    border: none !important;
    font-weight: 700 !important;
  }

  :global([data-sonner-toast][data-type='warning'] button[data-button]:hover) {
    background: hsl(var(--background) / 0.85) !important;
    border: none !important;
  }
</style>
