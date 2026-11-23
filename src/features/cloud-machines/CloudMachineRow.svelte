<!--
  Settings → one E2B, Northflank, Agent37 or Vercel entry; the meta line names its provider. Before setup it holds the inline setup form; after,
  it names the template and size, and the counts of its live sandboxes; the row
  opens their list (collapsed by default, kept per entry for the session). With named entries (Nodes), the name renames in place. Editing reopens
  the form; Remove deletes the entry's key and every sandbox it started.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import { Badge, type BadgeColor } from '$lib/components/ui/badge';
  import EditableName from '$lib/components/ui/EditableName.svelte';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import {
    faArrowUpRightFromSquare,
    faChevronDown,
    faCloud,
    faPen,
    faTrash,
  } from '$lib/icons/phosphor-icons';
  import { openExternalUrl } from '$lib/utils/open-external';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import {
    cloudProviderName,
    type CloudMachineProvider,
    type CloudProviderKind,
  } from '$shared/types/cloud-machines';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentBackendLabel } from '$features/remote-machines/remote-machines-selectors';
  import {
    selectCloudEntries,
    selectCloudEntriesSupported,
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxes,
  } from './cloud-machines-selectors';
  import {
    NEW_CLOUD_ENTRY,
    type CloudFormDraft,
    cloudConfigureKey,
    cloudMachineFailureDismissed,
    cloudMachinesConfigureRequested,
    cloudMachinesRemoveRequested,
    cloudRemoveKey,
  } from './cloud-machines-slice';
  import {
    agent37RegionLabel,
    agent37TypeLabel,
    cloudEntryNameError,
    cloudErrorText,
    cloudDashboardUrl,
    cloudProviderCopy,
    cloudSandboxCountsLabel,
  } from './cloud-machines-format';
  import { expandedSandboxLists } from './sandbox-groups.svelte';
  import MachinePlatformIcon from '$features/remote-machines/MachinePlatformIcon.svelte';
  import { machinePlatform } from '$features/remote-machines/machine-facts';
  import CloudMachineSetupForm from './CloudMachineSetupForm.svelte';
  import CloudSandboxList from './CloudSandboxList.svelte';
  import {
    withOrderActions,
    type MachineOrderControls,
  } from '$features/remote-machines/machine-order-controls';

  interface Props {
    /** The saved entry; null while a new one is set up. */
    entry: CloudMachineProvider | null;
    /** The provider of a new entry. */
    newProvider?: CloudProviderKind;
    /** Previews: the setup form's starting values. */
    initialDraft?: CloudFormDraft;
    /** The setup/edit form is open. */
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    /** First row of its list: no top border. */
    first?: boolean;
    /** Fixed clock for previews and tests. */
    now?: number;
    /** In the ordered runner list: Move up / Move down. */
    order?: MachineOrderControls;
  }

  let {
    entry,
    newProvider = 'e2b',
    initialDraft,
    editing,
    onEdit,
    onClose,
    first = false,
    now,
    order,
  }: Props = $props();
  const kind = $derived(entry?.provider ?? newProvider);

  const named$ = selectCloudEntriesSupported();
  const entries$ = selectCloudEntries();
  const sandboxes$ = selectCloudSandboxes();
  const backendLabel$ = selectCurrentBackendLabel();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();

  const name = $derived(entry?.name ?? cloudProviderName(kind));
  // The provider, unless the name already says it.
  const providerLabel = $derived(
    name.trim().toLowerCase() === cloudProviderName(kind).toLowerCase()
      ? null
      : cloudProviderName(kind),
  );
  const sandboxes = $derived(
    entry ? $sandboxes$.filter((machine) => machine.cloud?.cloudMachineId === entry.id) : [],
  );
  const removing = $derived(!!entry && $operations$[cloudRemoveKey(entry.id)] === 'removing');
  const removeFailure = $derived(entry ? ($failures$[cloudRemoveKey(entry.id)] ?? null) : null);
  // A rename's failure; the edit form shows its own.
  const renameFailure = $derived(
    entry && !editing ? ($failures$[cloudConfigureKey(entry.id)] ?? null) : null,
  );
  let renameError = $state<string | null>(null);

  const listId = $props.id();
  const counts = $derived(cloudSandboxCountsLabel(sandboxes));
  const showCounts = $derived(!!counts && !editing);
  // One sandbox is always shown: a toggle for a single row adds nothing.
  const expandable = $derived(!!entry && !editing && sandboxes.length > 1);
  // A failed Pause or Delete keeps the list open so its error shows.
  const sandboxFailed = $derived(sandboxes.some((machine) => !!$failures$[machine.id]));
  const listOpen = $derived(
    !!entry &&
      !editing &&
      (sandboxes.length === 1 ||
        (expandable && (expandedSandboxLists.has(entry.id) || sandboxFailed))),
  );

  function toggleList() {
    if (!entry) return;
    if (listOpen) expandedSandboxLists.delete(entry.id);
    else expandedSandboxLists.add(entry.id);
  }

  function onRowClick(event: MouseEvent) {
    if (!expandable) return;
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, textarea, [role="menu"], [role="menuitem"]')) return;
    toggleList();
  }

  // Sandboxes run Linux; a running one's own report wins.
  const platformIcon = $derived(machinePlatform(sandboxes[0]?.platform?.os || 'linux'));

  const status = $derived.by((): { label: string; color: BadgeColor } | null => {
    if (!entry) return null;
    switch (entry.state) {
      case 'ready':
        return {
          label: m.remoteMachines_state_available_label({ backend: $backendLabel$ }),
          color: 'green',
        };
      case 'key-rejected':
        return {
          label: cloudProviderCopy(kind).keyRejected,
          color: 'red',
        };
      default:
        return {
          label: cloudProviderCopy(kind).unreachable,
          color: 'amber',
        };
    }
  });

  // A ready entry shows no pill.
  const pillHidden = $derived(entry?.state === 'ready');
  // The counts follow a separator only after other meta text.
  const hasDetails = $derived(!!providerLabel || !!entry?.northflank?.region || !!entry?.agent37);
  const metaHasText = $derived(!pillHidden || hasDetails);

  const actions = $derived<ActionDefinition[]>(withOrderActions(ownActions(), order));

  function ownActions(): ActionDefinition[] {
    return entry
      ? [
          {
            id: 'dashboard',
            label: cloudProviderCopy(kind).dashboardOpen,
            icon: faArrowUpRightFromSquare,
          },
          { id: 'edit', label: m.cloudMachines_edit_label(), icon: faPen },
          {
            id: 'remove',
            label: m.cloudMachines_remove_label(),
            icon: faTrash,
            destructive: true,
            disabled: removing,
          },
        ]
      : [];
  }

  function onAction(id: string) {
    if (order?.onAction(id) || !entry) return;
    if (id === 'dashboard') void openExternalUrl(cloudDashboardUrl(kind));
    else if (id === 'edit') onEdit();
    else if (id === 'remove') appStore.dispatch(cloudMachinesRemoveRequested(entry.id));
  }

  function rename(next: string) {
    if (!entry) return;
    renameError = cloudEntryNameError(next, $entries$, entry.id);
    if (renameError) return;
    appStore.dispatch(cloudMachinesConfigureRequested({ cloudMachineId: entry.id, name: next }));
  }

  function failureText(failure: NonNullable<typeof removeFailure>) {
    if (failure.forbidden) return cloudProviderCopy(kind).ownerOnly;
    return failure.cloud ? cloudErrorText(failure.cloud, kind).description : failure.message;
  }
</script>

<article
  class={cn('@container', !first && 'border-t border-border')}
  aria-label={name}
  aria-busy={removing}
  data-cloud-machine-row={entry?.id ?? NEW_CLOUD_ENTRY}
  data-cloud-provider={kind}
>
  <ListRow
    class={cn(
      'items-center px-4 sm:px-5 [&>[data-slot]]:self-center',
      // A narrow row moves its meta line under the name instead of squeezing the name out.
      '[&_div:has(>[data-slot=list-row-title])]:flex-wrap [&_div:has(>[data-slot=list-row-title])]:gap-y-0.5',
      expandable && 'cursor-pointer',
    )}
    onclick={onRowClick}
  >
    {#snippet leading()}
      <span class="flex items-center gap-3">
        <!-- No status dot: a problem shows its pill. The spacer keeps the icon column. -->
        <span class="size-2.5" aria-hidden="true"></span>
        <Fa icon={faCloud} class="size-5! text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}
      <span>
        {#if entry && $named$ && !editing}
          <EditableName
            value={entry.name}
            onSave={rename}
            class="shrink-0"
            textClass="[font:inherit]"
            maxWidth={320}
            buttonAriaLabel={m.cloudMachines_rename_ariaLabel({ name: entry.name })}
            inputAriaLabel={m.cloudMachines_form_name_label()}
          />
        {:else}
          {name}
        {/if}
      </span>
    {/snippet}
    {#snippet meta()}
      <span class="inline-flex h-[1lh] items-center gap-1.5 align-top">
        {#if status}
          {#if platformIcon}<MachinePlatformIcon platform={platformIcon} />{/if}
          {#if !pillHidden}<Badge variant="dot" color={status.color}>{status.label}</Badge>{/if}
          <!-- Narrow rows with counts drop the provider details, so the name and counts stay. -->
          {#if hasDetails}
            <span class={cn('inline-flex items-center gap-1.5', showCounts && '@max-md:hidden')}>
              {#if providerLabel}<span data-cloud-provider-label>{providerLabel}</span>{/if}
              {#if entry?.northflank?.region}<span aria-hidden="true">·</span><span
                  >{entry.northflank.region}</span
                >{/if}
              {#if entry?.agent37}<span aria-hidden="true">·</span><span data-agent37-placement
                  >{agent37TypeLabel(entry.agent37.instanceType)}
                  <span aria-hidden="true">·</span>
                  {agent37RegionLabel(entry.agent37.region)}</span
                >{/if}
            </span>
          {/if}
          {#if showCounts}{#if metaHasText}<span
                aria-hidden="true"
                class={cn(pillHidden && '@max-md:hidden')}>·</span
              >{/if}<span class="whitespace-nowrap" data-cloud-sandbox-counts>{counts}</span>{/if}
        {:else}
          <span>{m.cloudMachines_row_notSaved()}</span>
        {/if}
      </span>
    {/snippet}
    {#snippet trailing()}
      {#if expandable}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={cloudProviderCopy(kind).listTitle}
          aria-expanded={listOpen}
          aria-controls={listId}
          onclick={toggleList}
          data-cloud-sandboxes-toggle
        >
          <span
            class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {listOpen
              ? ''
              : '-rotate-90'}"
          >
            <Fa icon={faChevronDown} class="size-3.5!" />
          </span>
        </Button>
      {/if}
      {#if actions.length > 0}
        <RowActions
          alwaysVisible
          {actions}
          {onAction}
          visibleCount={0}
          overflowLabel={m.settings_devices_actionsFor_ariaLabel({ name })}
        />
      {/if}
    {/snippet}
  </ListRow>

  {#if renameError || renameFailure}
    <div class="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5" role="alert">
      <p class="type-body text-danger">
        {renameError ?? (renameFailure ? failureText(renameFailure) : '')}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          renameError = null;
          if (entry) appStore.dispatch(cloudMachineFailureDismissed(cloudConfigureKey(entry.id)));
        }}>{m.cloudMachines_dismiss_label()}</Button
      >
    </div>
  {/if}

  {#if removeFailure}
    <div class="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5" role="alert">
      <p class="type-body text-danger">{failureText(removeFailure)}</p>
      {#if removeFailure.inUse && entry}
        <Button
          variant="outline"
          size="sm"
          onclick={() => appStore.dispatch(cloudMachinesRemoveRequested(entry.id, true))}
          >{m.cloudMachines_remove_stopAgents_label()}</Button
        >
      {/if}
    </div>
  {/if}

  {#if editing || !entry}
    <CloudMachineSetupForm
      {entry}
      newProvider={kind}
      {initialDraft}
      backendLabel={$backendLabel$}
      {onClose}
    />
  {:else if sandboxes.length > 0}
    <div id={listId} hidden={!listOpen}>
      {#if listOpen}
        <CloudSandboxList {sandboxes} entryName={entry.name} provider={kind} {now} />
      {/if}
    </div>
  {/if}
</article>
