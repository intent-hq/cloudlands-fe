<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  let {
    title,
    description,
    backHref,
    backLabel = 'Back',
    backShortcut,
    backShortcutLabel,
    onBack,
    busy = false,
    measure = 'standard',
    navigation,
    children,
    footer,
    class: className,
    contentClass,
  }: {
    title: string;
    description?: string;
    backHref?: string;
    backLabel?: string;
    backShortcut?: string;
    backShortcutLabel?: string;
    onBack?: (event: MouseEvent) => void;
    busy?: boolean;
    measure?: 'standard' | 'wide';
    navigation?: Snippet;
    children?: Snippet;
    footer?: Snippet;
    class?: string;
    contentClass?: string;
  } = $props();

  const contentMeasureClass = $derived(
    measure === 'wide' ? 'settings-measure-wide' : 'settings-measure-form',
  );
</script>

<section
  data-slot="settings-page-shell"
  class={cn(
    'settings-page-shell-layout grid h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground',
    className,
  )}
  aria-label={title}
  aria-busy={busy || undefined}
>
  <header
    data-slot="settings-page-header"
    class="min-w-0 border-b border-border bg-card shadow-(--elevation-raised)"
  >
    <div
      data-slot="settings-page-header-inner"
      data-measure="wide"
      class="settings-measure-wide mx-auto w-full px-4 pt-4 sm:px-6 sm:pt-5"
    >
      {#if onBack || backHref}
        <Button
          href={onBack ? undefined : backHref}
          onclick={onBack}
          variant="ghost"
          size="sm"
          class="mb-3 -ml-2"
          aria-label={backLabel}
        >
          <span>{backLabel}</span>
          {#if backShortcut}
            <kbd
              data-slot="settings-page-back-shortcut"
              class="type-caption ml-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-muted-foreground"
              aria-label={backShortcutLabel}
              aria-hidden={backShortcutLabel ? undefined : 'true'}>{backShortcut}</kbd
            >
          {/if}
        </Button>
      {/if}
      <div class="min-w-0 space-y-1.5 pb-5">
        <h1 class="type-display break-words text-foreground">{title}</h1>
        {#if description}
          <p class="type-body max-w-2xl text-muted-foreground">{description}</p>
        {/if}
      </div>
    </div>
    {#if navigation}
      <div
        data-slot="settings-page-navigation"
        class="min-w-0 max-w-full overflow-x-auto overscroll-x-contain"
      >
        <div class="settings-measure-wide mx-auto w-full px-4 sm:px-6">
          {@render navigation()}
        </div>
      </div>
    {/if}
  </header>
  <div data-slot="settings-page-content-scroll" class="min-h-0 min-w-0 overflow-auto">
    <div
      data-slot="settings-page-content"
      data-measure={measure}
      class={cn(
        'mx-auto w-full min-w-0 space-y-10 px-4 py-6 sm:px-6 sm:py-8',
        contentMeasureClass,
        contentClass,
      )}
    >
      {@render children?.()}
    </div>
  </div>
  {#if footer}
    <footer
      data-slot="settings-page-footer"
      class="type-body min-w-0 border-t border-border bg-card text-muted-foreground shadow-(--elevation-raised)"
    >
      <div
        data-slot="settings-page-footer-inner"
        data-measure="wide"
        class="settings-measure-wide mx-auto w-full px-4 py-3 sm:px-6"
      >
        {@render footer()}
      </div>
    </footer>
  {/if}
</section>

<style>
  .settings-page-shell-layout {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .settings-measure-form {
    max-width: var(--content-measure-form);
  }

  .settings-measure-wide {
    max-width: var(--content-measure-wide);
  }
</style>
