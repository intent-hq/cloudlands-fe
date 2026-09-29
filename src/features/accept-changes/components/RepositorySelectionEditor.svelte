<script module lang="ts">
  import { store } from '$store/renderer/store';
  import { selectRepositorySelectionForEdit } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import type { RepositorySelectionEdit } from '$shared/types/repository-selection';

  // Only adapt the absence of a local owner; all public eligibility stays in F's selector.
  const selectOwnedEdit = store.createSelector((state, owner: RepositorySelectionEdit | null) =>
    owner ? selectRepositorySelectionForEdit.select(state, owner) : null,
  );
</script>

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import { Form, FormField, FormActions } from '$lib/components/patterns/form';
  import { confirm } from '$lib/components/patterns/confirm';
  import { repositoryRootKey, type RepositoryRootIdentity } from '$shared/types/repository-context';
  import {
    SelectionCommandSchema,
    type SelectionCommand,
  } from '$shared/types/repository-selection';
  import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceManagementContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    repositorySelectionEditRequested,
    repositorySelectionConfirmRequested,
    repositorySelectionReconcileRequested,
    repositorySelectionEditEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import { m } from '$shared/paraglide/messages.js';

  let { root, label }: { root: RepositoryRootIdentity; label: string } = $props();
  let editButton = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let original = $state.raw<RepositorySelectionEdit | null>(null);
  let editLabel = $state('');
  let mode = $state('');
  let remoteName = $state('');
  let seeded = $state(false);
  let error = $state(false);
  let confirming = $state<string | null>(null);
  let submitted = $state<string | null>(null);
  const admission = selectPrincipalAdmissionContext();
  const management = selectWorkspaceManagementContext(toStore(() => root.workspaceId));
  const edit = selectOwnedEdit(toStore(() => original));
  const view = $derived($edit);
  const observation = $derived(view?.observation);
  const attempt = $derived(observation?.attempt);
  const receipt = $derived(attempt?.status === 'settled' ? attempt.receipt : null);
  const canSubmit = $derived(
    !!$management && view?.status === 'ready' && !!view.preview && !confirming && !submitted,
  );
  const choices = $derived([
    { value: 'automatic', label: m.repository_selection_automatic_label() },
    { value: 'explicit-remote', label: m.repository_selection_named_label() },
  ]);

  function endEdit() {
    const owner = original;
    original = null;
    confirming = null;
    submitted = null;
    seeded = false;
    mode = '';
    remoteName = '';
    error = false;
    if (owner) store.dispatch(repositorySelectionEditEnded(owner));
  }

  function beginEdit() {
    const state = store.state;
    const capturedAdmission = selectPrincipalAdmissionContext.select(state);
    if (!capturedAdmission || !selectWorkspaceManagementContext.select(state, root.workspaceId))
      return;
    endEdit();
    const owner = Object.freeze({
      root: Object.freeze({ ...root }),
      editId: crypto.randomUUID(),
      admission: capturedAdmission,
    });
    editLabel = label;
    original = owner;
    store.dispatch(repositorySelectionEditRequested(owner));
  }

  function eligible(owner: RepositorySelectionEdit) {
    return (
      original?.editId === owner.editId &&
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Pure shared root keys; no repository client or IO.
      repositoryRootKey(root) === repositoryRootKey(owner.root) &&
      selectPrincipalAdmissionContext.select(store.state) === owner.admission &&
      !!selectWorkspaceManagementContext.select(store.state, owner.root.workspaceId) &&
      selectRepositorySelectionForEdit.select(store.state, owner)?.status === 'ready' &&
      submitted !== owner.editId
    );
  }

  async function submit(reset = false) {
    const owner = original;
    if (!owner || confirming || !eligible(owner)) return;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Synchronous validation of the immutable command, not domain IO.
    const parsed = SelectionCommandSchema.safeParse(
      reset
        ? { kind: 'reset' }
        : {
            kind: 'save',
            choice: mode === 'automatic' ? { mode } : { mode, remoteName },
          },
    );
    error = !parsed.success;
    if (!parsed.success) return;
    const command: SelectionCommand = Object.freeze(
      parsed.data.kind === 'save'
        ? { ...parsed.data, choice: Object.freeze(parsed.data.choice) }
        : parsed.data,
    );
    const choiceLabel =
      command.kind === 'reset'
        ? m.repository_selection_reset_label()
        : command.choice.mode === 'automatic'
          ? m.repository_selection_automatic_label()
          : command.choice.remoteName;
    const description = m.repository_selection_confirm_description({
      choice: choiceLabel,
      repository: editLabel,
    });
    confirming = owner.editId;
    try {
      const agreed = await confirm({
        title: reset
          ? m.repository_selection_confirmReset_title()
          : m.repository_selection_confirmSave_title(),
        description,
        confirmLabel: m.repository_selection_confirm_label(),
        cancelLabel: m.repository_selection_cancel_label(),
      });
      if (!agreed || !eligible(owner)) return;
      submitted = owner.editId;
      store.dispatch(repositorySelectionConfirmRequested(owner, command));
    } finally {
      if (confirming === owner.editId) confirming = null;
    }
  }

  function reconcile() {
    const owner = original;
    if (!owner || !selectRepositorySelectionForEdit.select(store.state, owner)) return;
    store.dispatch(repositorySelectionReconcileRequested(owner));
  }

  $effect(() => {
    if (
      original &&
      // eslint-disable-next-line intent/no-component-async-data-fetch -- Pure shared identity comparison before original-owner cleanup.
      (repositoryRootKey(original.root) !== repositoryRootKey(root) ||
        (original.admission !== $admission &&
          original.admission !== selectPrincipalAdmissionContext.select(store.state)))
    )
      endEdit();
  });
  $effect(() => {
    if (seeded || !view?.preview) return;
    const saved = view.preview.snapshot.selection;
    mode =
      saved.kind !== 'saved'
        ? 'automatic'
        : saved.value.mode === 'automatic' || saved.value.mode === 'explicit-remote'
          ? saved.value.mode
          : '';
    remoteName =
      saved.kind === 'saved' && saved.value.mode === 'explicit-remote'
        ? saved.value.remoteName
        : '';
    seeded = true;
  });
  onDestroy(endEdit);
</script>

{#if $management || (original && view)}
  <div class="mt-3 grid min-w-0 gap-3" data-repository-selection>
    {#if $management}
      <Button
        bind:ref={editButton}
        variant="outline"
        size="compact"
        onclick={beginEdit}
        disabled={!!confirming}
      >
        {original && view
          ? m.repository_selection_fresh_label()
          : m.repository_selection_edit_label()}
      </Button>
    {/if}
    {#if original && view}
      <section aria-label={m.repository_selection_panel_label()} class="grid min-w-0 gap-3">
        <p class="text-muted-foreground">{m.repository_selection_scope_description()}</p>
        {#if view.status === 'capturing'}
          <p role="status">{m.repository_selection_loading_description()}</p>
        {:else if view.status === 'unavailable'}
          <p role="status">{m.repository_selection_unavailable_description()}</p>
        {/if}
        {#if view.preview}
          {@const saved = view.preview.snapshot.selection}
          <p data-selection-saved class="break-words text-muted-foreground">
            {#if saved.kind === 'neverSaved'}
              {m.repository_selection_neverSaved_description()}
            {:else if saved.kind === 'reset'}
              {m.repository_selection_reset_description()}
            {:else if saved.value.mode === 'automatic'}
              {m.repository_selection_saved_description({
                choice: m.repository_selection_automatic_label(),
              })}
            {:else if saved.value.mode === 'explicit-remote'}
              {m.repository_selection_saved_description({ choice: saved.value.remoteName })}
            {:else if saved.value.mode === 'migrated-canonical'}
              {m.repository_details_migrated_description()}
            {:else}
              {m.repository_selection_historical_description()}
            {/if}
          </p>
        {/if}
        {#if view.status === 'retired' || observation?.current === false}
          <p role="status">{m.repository_selection_retired_description()}</p>
        {/if}
        {#if seeded}
          <Form onSubmit={() => submit()} busy={!!confirming}>
            <FormField
              label={m.repository_selection_choice_label()}
              error={error ? m.repository_selection_invalid_error() : undefined}
            >
              {#snippet control(props)}
                <Select.Root bind:value={mode} items={choices} disabled={!canSubmit}>
                  <Select.Trigger {...props} disabled={!canSubmit}>
                    <Select.Value placeholder={m.repository_selection_choose_placeholder()} />
                  </Select.Trigger>
                  <Select.Content>
                    {#each choices as choice (choice.value)}
                      <Select.Item value={choice.value} label={choice.label}
                        >{choice.label}</Select.Item
                      >
                    {/each}
                  </Select.Content>
                </Select.Root>
              {/snippet}
            </FormField>
            {#if mode === 'explicit-remote'}
              <FormField label={m.repository_selection_remote_label()}>
                {#snippet control(props)}
                  <Input {...props} bind:value={remoteName} disabled={!canSubmit} />
                {/snippet}
              </FormField>
            {/if}
            <FormActions class="flex-wrap gap-2">
              {#snippet destructive()}
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={!canSubmit}
                  onclick={() => submit(true)}>{m.repository_selection_reset_label()}</Button
                >
              {/snippet}
              {#snippet primary()}
                <Button type="submit" size="compact" disabled={!canSubmit}
                  >{m.repository_selection_save_label()}</Button
                >
              {/snippet}
            </FormActions>
          </Form>
        {/if}
        <div aria-live="polite" class="grid gap-2" data-selection-observation>
          {#if observation?.uncertain}
            <p>{m.repository_selection_unobserved_description()}</p>
          {/if}
          {#if attempt?.status === 'notStarted'}
            <p>{m.repository_selection_notStarted_description()}</p>
          {:else if attempt?.status === 'pending' || (view.status === 'pending' && !observation)}
            <p>{m.repository_selection_pending_description()}</p>
          {/if}
          {#if receipt}
            <p data-selection-result>
              {#if receipt.result.kind === 'applied'}{m.repository_selection_applied_description()}
              {:else if receipt.result.kind === 'unchanged'}{m.repository_selection_unchanged_description()}
              {:else if receipt.result.kind === 'conflict'}{m.repository_selection_conflict_description()}
              {:else if receipt.result.kind === 'missingRoot'}{m.repository_selection_missingRoot_description()}
              {:else}{m.repository_selection_failed_description()}{/if}
            </p>
            <p data-selection-persistence>
              {#if receipt.persistence.kind === 'committed'}{m.repository_selection_committed_description()}
              {:else if receipt.persistence.kind === 'noEffect'}{m.repository_selection_noEffect_description()}
              {:else if receipt.persistence.kind === 'notAttempted'}{m.repository_selection_notAttempted_description()}
              {:else}{m.repository_selection_unknownPersistence_description()}{/if}
            </p>
          {/if}
        </div>
        <div class="flex flex-wrap gap-2">
          {#if observation || view.status === 'retired'}
            <Button variant="outline" size="compact" onclick={reconcile}
              >{m.repository_selection_check_label()}</Button
            >
          {/if}
          <Button
            variant="ghost"
            size="compact"
            onclick={() => {
              endEdit();
              void tick().then(() => editButton?.focus());
            }}>{m.repository_selection_close_label()}</Button
          >
        </div>
      </section>
    {/if}
  </div>
{/if}
