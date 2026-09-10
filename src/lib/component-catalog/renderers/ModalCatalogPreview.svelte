<script lang="ts">
  import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { InputMessage } from '$lib/components/ui/input-message';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

  let { fixture }: { componentId: 'modals'; fixture: UiComponentFixture } = $props();

  const states = [
    ['default', 'Default'],
    ['no-description', 'No description'],
    ['title-only', 'Title only'],
    ['with-icon-header', 'Icon header'],
    ['size-sm', 'Small'],
    ['size-lg', 'Large'],
    ['compact-density', 'Compact density'],
    ['long-content-scrolling', 'Long content scrolling'],
    ['busy', 'Busy'],
    ['invalid', 'Invalid'],
    ['destructive', 'Destructive'],
    ['disabled-close', 'Disabled close'],
    ['nested-content', 'Nested content'],
    ['zoom-200', '200% zoom'],
    ['reduced-motion', 'Reduced motion'],
  ] as const;
  type ModalState = (typeof states)[number][0];
</script>

{#snippet preview(state: ModalState)}
  <div class:modal-zoom-preview={state === 'zoom-200'}>
    <Dialog.Root open staticPosition>
      <Dialog.Content
        size={state === 'size-lg' ? 'lg' : 'sm'}
        closeDisabled={state === 'busy' || state === 'disabled-close'}
        class={state === 'long-content-scrolling' ? 'max-h-72' : undefined}
      >
        {#if state === 'with-icon-header'}
          <Dialog.Header class="flex-row items-start">
            <span class="mt-0.5 text-danger"><Fa icon={faCircleExclamation} /></span>
            <div class="grid gap-1.5">
              <Dialog.Title>Review this change</Dialog.Title>
              <Dialog.Description
                >Check the affected workspace before continuing.</Dialog.Description
              >
            </div>
          </Dialog.Header>
        {:else if state === 'title-only'}
          <Dialog.Title>Dialog title</Dialog.Title>
        {:else}
          <Dialog.Header>
            <Dialog.Title
              >{state === 'destructive' ? 'Delete workspace?' : 'Edit workspace'}</Dialog.Title
            >
            {#if state !== 'no-description'}
              <Dialog.Description>
                {state === 'invalid'
                  ? 'Resolve the validation error before saving.'
                  : 'Update the workspace details and save your changes.'}
              </Dialog.Description>
            {/if}
          </Dialog.Header>
        {/if}

        {#if state === 'no-description'}
          <p class="type-body text-muted-foreground">
            The description slot is intentionally omitted.
          </p>
        {:else if state === 'long-content-scrolling'}
          <div class="grid gap-3">
            {#each Array.from({ length: 10 }) as _, index (index)}
              <p class="type-body">Workspace detail row {index + 1} remains inside the dialog.</p>
            {/each}
          </div>
        {:else if state === 'invalid'}
          <div>
            <Input aria-label="Workspace name" aria-invalid="true" value="" />
            <InputMessage tone="error">A workspace name is required.</InputMessage>
          </div>
        {:else if state === 'nested-content'}
          <div class="grid gap-3">
            <Input aria-label="Workspace name" value="Design system" />
            <Input aria-label="Workspace path" value="/workspaces/design-system" />
          </div>
        {:else if state !== 'title-only'}
          <p class="type-body text-muted-foreground">
            {state === 'destructive'
              ? 'This removes local workspace data and cannot be undone.'
              : 'The dialog body uses the standard content composition.'}
          </p>
        {/if}

        {#if state !== 'title-only'}
          <Dialog.Footer>
            <Button variant="ghost" disabled={state === 'busy'}>Cancel</Button>
            <Button
              variant={state === 'destructive' ? 'destructive' : 'default'}
              loading={state === 'busy'}
              disabled={state === 'invalid'}
            >
              {state === 'destructive' ? 'Delete workspace' : 'Save changes'}
            </Button>
          </Dialog.Footer>
        {/if}
      </Dialog.Content>
    </Dialog.Root>
  </div>
{/snippet}

<div
  class="grid min-w-0 gap-6"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  <section class="grid gap-3" aria-labelledby="dialog-primitive-title">
    <h2 id="dialog-primitive-title" class="text-base font-medium">Dialog primitive</h2>
    <div class="modal-preview-grid">
      {#each states as [state, label] (state)}
        <article class="grid min-w-0 content-start gap-2" data-modal-preview={state}>
          <h3 class="text-xs font-medium text-muted-foreground">{label}</h3>
          <div class="relative min-h-88 overflow-hidden rounded-md bg-muted/40 py-4">
            {#if state === 'compact-density'}
              <SizeProvider size="compact">{@render preview(state)}</SizeProvider>
            {:else}
              {@render preview(state)}
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </section>
</div>

<style>
  .modal-preview-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
    gap: 1rem;
  }

  .modal-zoom-preview {
    width: 50%;
    zoom: 2;
  }
</style>
