<script lang="ts">
  import ActionMenuHarness from '$lib/components/patterns/action-menu/ActionMenuHarness.svelte';
  import CollectionHarness from '$lib/components/patterns/collection/CollectionHarness.svelte';
  import DestructiveConfirm from '$lib/components/patterns/confirm/DestructiveConfirm.svelte';
  import FormDialog from '$lib/components/patterns/confirm/FormDialog.svelte';
  import FormHarness from '$lib/components/patterns/form/FormHarness.svelte';
  import NotifyErrorToast from '$lib/components/patterns/notify/NotifyErrorToast.svelte';
  import ScreenHarness from '$lib/components/patterns/screen/ScreenHarness.svelte';
  import SettingsHarness from '$lib/components/patterns/settings/SettingsHarness.svelte';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

  let { patternId, fixture }: { patternId: string; fixture: UiComponentFixture } = $props();

  function screenState(state: string): 'screen' | 'takeover' | 'empty' | 'error' | 'loading' {
    if (state === 'takeover') return 'takeover';
    if (state === 'empty') return 'empty';
    if (state === 'error') return 'error';
    if (state.startsWith('loading')) return 'loading';
    return 'screen';
  }
</script>

<div data-pattern-contract={patternId} data-catalog-renderer-fixture={fixture.id}>
  {#each fixture.states as state}
    <section data-catalog-rendered-state={state}>
      {#if patternId === 'action-menu'}
        <ActionMenuHarness
          bar={state === 'action-bar' || state === 'overflow'}
          context={state === 'context-menu'}
        />
      {:else if patternId === 'collection'}
        <CollectionHarness />
      {:else if patternId === 'confirm'}
        {#if fixture.id === 'destructive-confirm'}
          <DestructiveConfirm
            open
            title="Remove workspace"
            description="This action cannot be undone."
            confirmLabel="Remove workspace"
            typedConfirmation={state === 'typed-name' ? 'workspace' : undefined}
            typedLabel={state === 'typed-name' ? 'Type workspace to confirm' : undefined}
            busy={state === 'busy'}
            onConfirm={() => undefined}
          />
        {:else}
          <FormDialog
            open
            title={fixture.title}
            description="Review and confirm this catalog action."
            busy={state === 'busy'}
            canSubmit={state !== 'invalid'}
            showCancel={state !== 'alert'}
            onSubmit={() => undefined}
          />
        {/if}
      {:else if patternId === 'form'}
        <FormHarness error={state === 'error' ? undefined : ''} busy={state === 'submitting'} />
      {:else if patternId === 'notify'}
        <NotifyErrorToast
          message={`${state} notification`}
          details="Deterministic catalog details"
        />
      {:else if patternId === 'screen'}
        <ScreenHarness state={screenState(state)} />
      {:else if patternId === 'settings'}
        <SettingsHarness searchQuery={state === 'filtered' ? 'choice' : ''} />
      {/if}
    </section>
  {/each}
</div>
