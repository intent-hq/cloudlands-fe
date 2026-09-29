<script module lang="ts">
  import {
    repositoryRootKey,
    repositoryTargetKey,
    type RepositoryRootIdentity,
  } from '$shared/types/repository-context';
  import { store } from '$store/renderer/store';
  import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectRepositoryContextForDemand } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import {
    repositoryContextDemanded,
    repositoryContextDemandEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import type { RepositoryContextDemand } from '$store/renderer/slices/repository-context/repository-context-types';

  // Pure presentation selection. Observation stays in the existing root saga.
  const selectSummary = store.createSelector(
    (state, original: RepositoryContextDemand | null, root: RepositoryRootIdentity) => {
      const current =
        original?.workspaceId === root.workspaceId
          ? selectRepositoryContextForDemand.select(state, original)
          : null;
      const entry =
        current?.status === 'ready'
          ? current.roots.find(
              (candidate) => repositoryRootKey(candidate.root) === repositoryRootKey(root),
            )
          : undefined;
      const selection = entry?.reviewSelection;
      const target = selection?.outcome.state === 'resolved' ? selection.outcome.target : null;
      const availability = target
        ? entry?.targets.find(
            (candidate) => repositoryTargetKey(candidate.target) === repositoryTargetKey(target),
          )?.availability
        : undefined;
      return { current, entry, selection, target, availability };
    },
  );
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { toStore } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { DataList } from '$lib/components/patterns/collection';
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  let { root }: { root: RepositoryRootIdentity } = $props();
  const detailsId = $props.id();
  let open = $state(false);
  // UI ownership only. Repository facts stay in the root-owned Redux slice.
  let demand = $state<RepositoryContextDemand | null>(null);
  const admission = selectPrincipalAdmissionContext();
  const summary = selectSummary(
    toStore(() => demand),
    toStore(() => root),
  );
  const current = $derived($summary.current);
  const entry = $derived($summary.entry);
  const selection = $derived($summary.selection);
  const target = $derived($summary.target);
  const availability = $derived($summary.availability);

  function endRead() {
    const original = demand;
    demand = null;
    if (original)
      store.dispatch(
        repositoryContextDemandEnded(original.workspaceId, original.demandId, original.admission),
      );
  }

  function readAgain() {
    endRead();
    const original: RepositoryContextDemand = Object.freeze({
      workspaceId: root.workspaceId,
      demandId: crypto.randomUUID(),
      admission: selectPrincipalAdmissionContext.select(store.state),
    });
    demand = original;
    store.dispatch(
      repositoryContextDemanded(original.workspaceId, original.demandId, original.admission),
    );
  }

  function toggle() {
    open = !open;
    if (open) readAgain();
    else endRead();
  }

  $effect(() => {
    // The readable may still be delivering the previous admission when an
    // explicit click captures the new one. Never retire that fresh demand
    // using a lagging notification; check the actual Store at teardown.
    if (
      demand &&
      (demand.workspaceId !== root.workspaceId ||
        (demand.admission !== $admission &&
          demand.admission !== selectPrincipalAdmissionContext.select(store.state)))
    )
      endRead();
  });
  onDestroy(endRead);

  const availabilityLabel = $derived(
    availability === 'connected'
      ? m.settings_connections_connected()
      : availability === 'disconnected'
        ? m.settings_mcp_status_disconnected()
        : availability === 'disabled'
          ? m.settings_mcp_status_disabled()
          : availability === 'unsupported'
            ? m.repository_details_unsupported_label()
            : m.repository_details_unknown_label(),
  );
  const rows = $derived([
    ...(target
      ? [
          {
            key: 'provider',
            label: m.repository_details_provider_label(),
            value: target.provider === 'github' ? 'GitHub' : 'GitLab',
          },
          {
            key: 'instance',
            label: m.repository_details_instance_label(),
            value: target.instanceBaseUrl,
          },
          {
            key: 'project',
            label: m.repository_details_project_label(),
            value: target.projectPath,
          },
          {
            key: 'availability',
            label: m.repository_details_availability_label(),
            value: availabilityLabel,
          },
        ]
      : []),
    {
      key: 'branch',
      label: m.ui_openCombo_copyBranch_shortLabel(),
      value: entry?.branch ?? m.repository_details_unknown_label(),
    },
  ]);
</script>

<section
  data-repository-summary
  class="@container min-w-0 px-2 py-1"
  aria-label={m.repository_details_title_label()}
>
  <Button
    variant="ghost"
    size="compact"
    class="w-full justify-between"
    wrapContent={false}
    aria-expanded={open}
    aria-controls={detailsId}
    onclick={toggle}
  >
    <span class="min-w-0 break-words">{m.repository_details_title_label()}</span>
    <span class:rotate-90={open} aria-hidden="true"><Fa icon={faChevronRight} /></span>
  </Button>
  {#if open}
    <div
      id={detailsId}
      class="min-w-0 px-2 pb-2 type-caption"
      aria-busy={current?.status === 'loading'}
    >
      {#if current?.status === 'loading'}
        <p role="status" class="py-2 text-muted-foreground">
          {m.repository_details_loading_description()}
        </p>
      {:else if !current || current.status === 'inactive'}
        <p role="status" class="py-2 text-muted-foreground">
          {m.repository_details_inactive_description()}
        </p>
      {:else if current.status === 'unavailable'}
        <p role="status" class="py-2 text-muted-foreground">
          {m.repository_details_unavailable_description()}
        </p>
      {:else if !entry || !selection}
        <p role="status" class="py-2 text-muted-foreground">
          {m.repository_details_missingRoot_description()}
        </p>
      {:else}
        <p class="pt-2 text-muted-foreground">
          {#if selection.outcome.state === 'resolved'}
            {m.repository_details_resolved_description()}
          {:else if selection.outcome.state === 'repository-unavailable'}
            {m.repository_details_noRemote_description()}
          {:else if selection.outcome.reason === 'missing-selected-remote'}
            {m.repository_details_missingRemote_description()}
          {:else if selection.outcome.reason === 'unresolved-historical-choice'}
            {m.repository_details_history_description()}
          {:else}
            {m.repository_details_selectionRequired_description()}
          {/if}
        </p>
        <DataList
          items={rows}
          class="[&>div]:grid-cols-1 [&>div]:gap-1 @min-[22rem]:[&>div]:grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)] @min-[22rem]:[&>div]:gap-4"
        >
          {#snippet value(item)}<span class="[overflow-wrap:anywhere]">{item.value}</span>{/snippet}
        </DataList>
        {#if selection.saved.mode !== 'unresolved-historical' || selection.outcome.state !== 'selection-required' || selection.outcome.reason !== 'unresolved-historical-choice'}
          <p class="break-words text-muted-foreground">
            {#if selection.saved.mode === 'automatic'}
              {m.repository_details_automatic_description()}
            {:else if selection.saved.mode === 'explicit-remote'}
              {m.repository_details_explicit_description({ remote: selection.saved.remoteName })}
            {:else if selection.saved.mode === 'migrated-canonical'}
              {m.repository_details_migrated_description()}
            {:else}
              {m.repository_details_history_description()}
            {/if}
          </p>
        {/if}
      {/if}
      <Button
        variant="ghost"
        size="compact"
        class="mt-2"
        onclick={readAgain}
        disabled={current?.status === 'loading'}
      >
        {m.repository_details_readAgain_label()}
      </Button>
    </div>
  {/if}
</section>
