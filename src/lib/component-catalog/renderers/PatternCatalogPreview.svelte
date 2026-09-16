<script lang="ts">
  import ActionMenuHarness from '$lib/components/patterns/action-menu/ActionMenuHarness.svelte';
  import CollectionHarness from '$lib/components/patterns/collection/CollectionHarness.svelte';
  import CollectionStateHarness from '$lib/components/patterns/collection/CollectionStateHarness.svelte';
  import CardInsetContractHarness from '$lib/components/patterns/collection/CardInsetContractHarness.svelte';
  import DestructiveConfirm from '$lib/components/patterns/confirm/DestructiveConfirm.svelte';
  import FormDialog from '$lib/components/patterns/confirm/FormDialog.svelte';
  import FormHarness from '$lib/components/patterns/form/FormHarness.svelte';
  import NotifyErrorToast from '$lib/components/patterns/notify/NotifyErrorToast.svelte';
  import ScreenHarness from '$lib/components/patterns/screen/ScreenHarness.svelte';
  import SettingsHarness from '$lib/components/patterns/settings/SettingsHarness.svelte';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();

  function screenState(
    state: string,
  ):
    | 'screen'
    | 'takeover'
    | 'empty'
    | 'error'
    | 'error-danger'
    | 'loading-list'
    | 'loading-card-grid'
    | 'loading-form' {
    if (state === 'takeover') return 'takeover';
    if (state === 'empty') return 'empty';
    if (state === 'error') return 'error';
    if (state === 'error-danger') return 'error-danger';
    if (state === 'loading-list') return 'loading-list';
    if (state === 'loading-card-grid') return 'loading-card-grid';
    if (state === 'loading-form') return 'loading-form';
    return 'screen';
  }
</script>

<div data-pattern-contract={componentId} data-catalog-renderer-fixture={fixture.id}>
  {#each fixture.states as state}
    <section data-catalog-rendered-state={state}>
      {#if componentId === 'action-menu'}
        <ActionMenuHarness
          bar={state === 'action-bar' || state === 'overflow'}
          context={state === 'context-menu'}
        />
      {:else if componentId === 'collection'}
        {#if state === 'card-inset'}
          <CardInsetContractHarness />
        {:else if state === 'empty' || state === 'loading' || state === 'error'}
          <CollectionStateHarness status={state === 'empty' ? 'ready' : state} />
        {:else}
          <CollectionHarness />
        {/if}
      {:else if componentId === 'confirm'}
        {#if fixture.id === 'destructive-confirm'}
          <DestructiveConfirm
            open
            static
            title="Remove workspace"
            description="This action cannot be undone."
            confirmLabel="Remove workspace"
            busy={state === 'busy'}
            onConfirm={() => undefined}
          />
        {:else}
          <FormDialog
            open
            static
            title={fixture.title}
            description="Review and confirm this catalog action."
            busy={state === 'busy'}
            canSubmit={state !== 'invalid'}
            showCancel={state !== 'alert'}
            onSubmit={() => undefined}
          />
        {/if}
      {:else if componentId === 'form'}
        <FormHarness error={state === 'error' ? undefined : ''} busy={state === 'submitting'} />
      {:else if componentId === 'notify'}
        <NotifyErrorToast
          message={`${state} notification`}
          details="Deterministic catalog details"
        />
      {:else if componentId === 'screen'}
        <ScreenHarness state={screenState(state)} />
      {:else if componentId === 'settings'}
        <SettingsHarness searchQuery={state === 'filtered' ? 'choice' : ''} />
      {/if}
    </section>
  {/each}
</div>
