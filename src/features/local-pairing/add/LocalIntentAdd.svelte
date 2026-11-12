<script lang="ts">
  /**
   * Settings → Machines → Add machine → Intent on this computer (Labs),
   * connected to the store: the saga reads the discovery folder and redeems.
   */
  import { store as appStore } from '$store/renderer/store';
  import LocalIntentAddForm from './LocalIntentAddForm.svelte';
  import { selectLocalIntentAdd } from './local-intent-add-selectors';
  import {
    localIntentAddClosed,
    localIntentCodeEdited,
    localIntentPicked,
    localIntentRedeemSubmitted,
    stashLocalCode,
  } from './local-intent-add-slice';

  const state$ = selectLocalIntentAdd();
  const add = $derived($state$);
</script>

{#if add.phase !== 'closed'}
  <LocalIntentAddForm
    phase={add.phase}
    intents={add.intents}
    listFailed={add.listFailed}
    selectedId={add.selectedId}
    error={add.error}
    addedName={add.addedName}
    codeResets={add.codeResets}
    onPick={(instanceId) => appStore.dispatch(localIntentPicked(instanceId))}
    onSubmit={(code) => {
      stashLocalCode(code);
      appStore.dispatch(localIntentRedeemSubmitted());
    }}
    onCodeEdited={() => {
      if (add.error?.code === 'code-format') appStore.dispatch(localIntentCodeEdited());
    }}
    onClose={() => appStore.dispatch(localIntentAddClosed())}
  />
{/if}
