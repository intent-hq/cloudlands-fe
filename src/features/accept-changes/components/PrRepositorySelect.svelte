<script module lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import { selectRepositorySelectionForEdit } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import type { RepositorySelectionEdit } from '$shared/types/repository-selection';
  import { prRepositoryOptions } from '../utils/pr-repository-options';
  import { repositoryRootKey, type RepositoryRootContext } from '$shared/types/repository-context';

  const selectPicker = appStore.createSelector(
    (state, context: RepositoryRootContext | null, owner: RepositorySelectionEdit | null) => ({
      options: prRepositoryOptions(context),
      edit: owner ? selectRepositorySelectionForEdit.select(state, owner) : null,
      sameRoot:
        !owner || (!!context && repositoryRootKey(context.root) === repositoryRootKey(owner.root)),
    }),
  );
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { toStore } from 'svelte/store';
  import { FormField } from '$lib/components/patterns/form';
  import { Select } from '$lib/components/ui/select';
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    repositorySelectionEditRequested,
    repositorySelectionEditEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import { m } from '$shared/paraglide/messages.js';

  let {
    context,
    disabled = false,
    onsaved,
  }: {
    context: RepositoryRootContext | null;
    disabled?: boolean;
    onsaved: () => void;
  } = $props();
  let owner = $state.raw<RepositorySelectionEdit | null>(null);
  let reported = $state<string | null>(null);
  const admission = selectPrincipalActionContext();
  const management = selectWorkspaceActionContext(toStore(() => context?.root.workspaceId ?? ''));
  const picker = selectPicker(
    toStore(() => context),
    toStore(() => owner),
  );
  const edit = $derived($picker.edit);
  const busy = $derived(
    edit?.status === 'capturing' ||
      (edit?.status === 'pending' &&
        (!edit.observation || edit.observation.attempt?.status === 'pending')),
  );
  const attempt = $derived(edit?.observation?.attempt);
  const result = $derived(attempt?.status === 'settled' ? attempt.receipt.result : null);
  const saved = $derived(result?.kind === 'applied' || result?.kind === 'unchanged');
  const failed = $derived(
    !busy &&
      !saved &&
      (!!edit?.observation || edit?.status === 'unavailable' || edit?.status === 'retired'),
  );
  const items = $derived(
    $picker.options.map(({ remoteName, target }) => ({
      value: remoteName,
      label: m.repository_prRemote_option_label({
        remote: remoteName,
        provider: target.provider === 'github' ? 'GitHub' : 'GitLab',
        repository: target.projectPath,
      }),
    })),
  );
  const value = $derived(
    context?.reviewSelection.saved.mode === 'explicit-remote'
      ? context.reviewSelection.saved.remoteName
      : '',
  );

  function endEdit() {
    const original = owner;
    owner = null;
    if (original) appStore.dispatch(repositorySelectionEditEnded(original));
  }

  function choose(remoteName: string) {
    const current = context;
    const state = appStore.state;
    const capturedAdmission = selectPrincipalActionContext.select(state);
    if (
      !current ||
      disabled ||
      busy ||
      !capturedAdmission ||
      !selectWorkspaceActionContext.select(state, current.root.workspaceId) ||
      !selectPicker
        .select(state, current, owner)
        .options.some((option) => option.remoteName === remoteName)
    )
      return;
    endEdit();
    const original = {
      root: current.root,
      editId: crypto.randomUUID(),
      admission: capturedAdmission,
    };
    owner = original;
    appStore.dispatch(
      repositorySelectionEditRequested(original, {
        kind: 'save',
        choice: { mode: 'explicit-remote', remoteName },
      }),
    );
  }

  $effect(() => {
    if (owner && (!$picker.sameRoot || owner.admission !== $admission)) endEdit();
  });
  $effect(() => {
    if (saved && owner && reported !== owner.editId) {
      reported = owner.editId;
      untrack(onsaved);
    }
  });
  onDestroy(endEdit);
</script>

{#if items.length && $management}
  <FormField
    label={m.repository_prRemote_label()}
    error={failed ? m.repository_prRemote_save_error() : undefined}
    class="mb-3"
  >
    {#snippet control(props)}
      <Select.Root
        bind:value={() => value, choose}
        {items}
        disabled={disabled || busy}
        invalid={failed}
      >
        <Select.Trigger {...props} disabled={disabled || busy}>
          <Select.Value placeholder={m.repository_prRemote_placeholder()} />
        </Select.Trigger>
        <Select.Content>
          {#each items as item (item.value)}
            <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/snippet}
  </FormField>
{/if}
