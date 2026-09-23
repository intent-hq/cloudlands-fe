<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { InputMessage } from '$lib/components/ui/input-message';

  let {
    title,
    description,
    titleId,
    descriptionId,
    children,
    headerActions,
    footer,
    error,
  }: {
    title: string;
    description?: string;
    titleId?: string;
    descriptionId?: string;
    children?: Snippet;
    headerActions?: Snippet;
    footer?: Snippet;
    error?: string;
  } = $props();
</script>

<div class="dialog-layout flex min-h-0 min-w-0 flex-1 flex-col">
  <Dialog.Header class="m-0 shrink-0 px-6 pt-6 {headerActions ? 'pr-22' : 'pr-14'}">
    {#if headerActions}
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <Dialog.Title id={titleId}>{title}</Dialog.Title>
        <div
          class="absolute right-14 top-[calc(1.5rem+var(--text-title-line-height)/2)] -translate-y-1/2"
        >
          {@render headerActions()}
        </div>
      </div>
    {:else}
      <Dialog.Title id={titleId}>{title}</Dialog.Title>
    {/if}
    {#if description}<Dialog.Description id={descriptionId}>{description}</Dialog.Description>{/if}
  </Dialog.Header>
  {#if children || error}
    <div
      data-slot="dialog-body"
      class="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-6 pt-5 {footer
        ? 'pb-5'
        : 'pb-6'}"
    >
      <div class="grid min-w-0 gap-4">
        {@render children?.()}
        {#if error}<InputMessage tone="error">{error}</InputMessage>{/if}
      </div>
    </div>
  {/if}
  {#if footer}
    <Dialog.Footer class={children ? 'm-0 shrink-0 px-6 pb-6' : 'm-0 shrink-0 p-6'}>
      {@render footer()}
    </Dialog.Footer>
  {:else if !children}
    <div class="h-6 shrink-0" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .dialog-layout {
    container-type: inline-size;
  }

  @container (max-width: 24rem) {
    .dialog-layout :global([data-slot='form-actions']) {
      flex-wrap: wrap;
      width: 100%;
    }
    .dialog-layout :global([data-slot='form-actions-end']) {
      flex-wrap: wrap;
      min-width: 0;
      width: 100%;
      justify-content: flex-end;
    }
  }
</style>
