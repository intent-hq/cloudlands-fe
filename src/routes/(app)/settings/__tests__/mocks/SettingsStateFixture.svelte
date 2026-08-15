<script lang="ts">
  import { getContext } from 'svelte';
  import {
    SETTINGS_STATE_FIXTURE_CONTEXT,
    type SettingsStateFixtureContext,
  } from '../settings-page.fixtures';

  interface Props {
    activeView?: { type: string; id?: string };
    workspaceId?: string | null;
  }

  let { activeView, workspaceId }: Props = $props();
  const context = getContext<SettingsStateFixtureContext>(SETTINGS_STATE_FIXTURE_CONTEXT);
  const { fixture, catalogSize, ownerSource } = context;
  let owner = $state(context.owner);
  let actionState = $state('idle');
  let saveState = $state('idle');
  let saveConfirmationOpen = $state(false);

  async function transitionAction(intent: 'add' | 'retry' | 'confirm') {
    owner = await context.transition(intent);
    actionState = `${intent}:${owner.value}`;
  }

  async function transitionSave() {
    owner = await context.transition('save');
    saveState = `saved:${owner.value}`;
  }

  async function saveOnEnter(event: KeyboardEvent) {
    if (event.key === 'Enter') await transitionSave();
  }
</script>

<div
  data-testid="settings-state-fixture"
  data-tab={fixture.tab}
  data-state={owner.state}
  data-state-owner={fixture.stateOwner}
  data-owner-source={ownerSource}
  data-owner-value={owner.value}
  data-save-mode={fixture.saveMode}
  data-catalog-size={catalogSize}
>
  <p>Fixture state: {owner.state}</p>
  <p>Owner value: {owner.value}</p>
  <p data-testid="fixture-action-state">Action: {actionState}</p>
  <p data-testid="fixture-save-state">Save: {saveState}</p>
  {#if activeView}
    <p data-testid="ai-behavior-view">
      {activeView.type}{activeView.id ? `:${activeView.id}` : ''}
    </p>
    <p
      data-testid="ai-behavior-workspace-id"
      data-workspace-id-kind={workspaceId === null
        ? 'null'
        : workspaceId === undefined
          ? 'undefined'
          : 'value'}
    >
      {workspaceId ?? 'none'}
    </p>
  {/if}

  {#if owner.state === 'loading'}
    <p role="status">Loading {fixture.label} settings</p>
  {:else if owner.state === 'empty'}
    <p>No configured {fixture.label.toLowerCase()} items</p>
    <button type="button" onclick={() => transitionAction('add')}>Add {fixture.label} item</button>
  {:else if owner.state === 'validation'}
    <label>
      Fixture value
      <input aria-invalid="true" value="Invalid fixture value" />
    </label>
    <p role="alert">Fix the invalid value before saving</p>
  {:else if owner.state === 'error'}
    <p role="alert">Unable to load {fixture.label} settings</p>
    <button type="button" onclick={() => transitionAction('retry')}>Retry</button>
  {:else if owner.state === 'success'}
    <p role="status">{fixture.label} settings saved</p>
  {:else if owner.state === 'disabled'}
    <button type="button" disabled>Unavailable setting</button>
  {:else if owner.state === 'confirmation'}
    <div role="dialog" aria-label="Confirm settings change">
      <p>Confirm this settings change</p>
      <button type="button" onclick={() => transitionAction('confirm')}>Confirm state change</button
      >
    </div>
  {/if}

  {#if fixture.saveMode === 'immediate'}
    <button type="button" onclick={transitionSave}>Apply immediately</button>
  {:else if fixture.saveMode === 'autosave'}
    <label>
      Autosave value
      <input aria-label="Autosave value" oninput={transitionSave} />
    </label>
  {:else if fixture.saveMode === 'blur-or-enter'}
    <label>
      Blur or Enter value
      <input aria-label="Blur or Enter value" onblur={transitionSave} onkeydown={saveOnEnter} />
    </label>
  {:else if fixture.saveMode === 'explicit'}
    <button type="button" onclick={transitionSave}>Save changes</button>
  {:else}
    <button type="button" onclick={() => (saveConfirmationOpen = true)}>Review save</button>
    {#if saveConfirmationOpen}
      <div role="dialog" aria-label="Confirm fixture save">
        <button
          type="button"
          onclick={async () => {
            await transitionSave();
            saveConfirmationOpen = false;
          }}>Confirm fixture save</button
        >
      </div>
    {/if}
  {/if}
</div>
