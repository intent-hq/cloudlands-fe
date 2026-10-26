<script lang="ts">
  /**
   * Named profiles of one installed provider (§5.54), shown inside its
   * Settings → Providers row: honest per-profile status, rename/edit, and
   * removal that is blocked while saved selections still use the profile.
   * Adding starts from the provider row's actions menu (ProviderSelector).
   * Profiles can be reordered (drag or ArrowUp/ArrowDown on the handle) and
   * backups carry a badge; a profile without `backup` is not a backup.
   *
   * With any named profile, the provider's Default configuration (the bare
   * base provider, where backup failover starts) is pinned as the first row:
   * it cannot be moved and nothing can be dropped above it. It shows its saved
   * name, plus a Default pill unless that name is already "Default". The app's
   * default model/provider is not labelled here (Default model owns it).
   */
  import {
    faArrowsRotate,
    faCheck,
    faGripLines,
    faPen,
    faTrash,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { confirm } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
  import {
    Button,
    IntentMarkLoader,
    Menu,
  } from '$lib/components/patterns/settings/custom-controls';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import type { ProviderProfile } from '$shared/provider-profiles';
  import { isProviderAuthenticationReady } from '$shared/types/provider-availability';
  import { describeInUse, runningProcessesNotice } from '$features/settings/profile-env-form';
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileActivationDismissed,
    providerProfileCheckRequested,
    providerProfileDeleteRequested,
    providerProfileMutationDismissed,
    providerProfileReorderRequested,
    providerProfilesRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderDefaultConfig,
    selectProviderProfileActivationMap,
    selectProviderProfileMutations,
    selectProviderProfilesForBase,
    selectProviderProfilesLoadStatus,
    selectProviderProfileStatusMap,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectFastModeSupportedProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import {
    selectProviderLoadingMap,
    selectProviderStatusMap,
  } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import { checkSingleProviderRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { selectIsDaemonAppOwned } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import ProviderProfileDialog from './ProviderProfileDialog.svelte';
  import ProviderFastModeMenuItems from './ProviderFastModeMenuItems.svelte';

  interface Props {
    providerId: string;
    providerName: string;
  }

  let { providerId, providerName }: Props = $props();

  // svelte-ignore state_referenced_locally
  const profiles$ = selectProviderProfilesForBase(providerId);
  const loadStatus$ = selectProviderProfilesLoadStatus();
  const status$ = selectProviderProfileStatusMap();
  const activation$ = selectProviderProfileActivationMap();
  const mutations$ = selectProviderProfileMutations();
  const inUse$ = selectProviderInUseReasons();
  // svelte-ignore state_referenced_locally
  const defaultConfig$ = selectProviderDefaultConfig(providerId);
  const providerStatusMap$ = selectProviderStatusMap();
  const providerLoadingMap$ = selectProviderLoadingMap();
  const appOwned$ = selectIsDaemonAppOwned();
  const fastModeProviders$ = selectFastModeSupportedProviders();
  // Each profile has its own Fast mode / service tier, offered exactly when
  // the base provider's is.
  const offersFastMode = $derived($fastModeProviders$.includes(providerId));

  let dialogOpen = $state(false);
  let editing = $state<ProviderProfile | undefined>(undefined);
  let defaultDialogOpen = $state(false);

  const DEFAULT_NAME = m.chat_modelPicker_defaultProfile_name();
  // A blank or absent saved name (older daemons) reads as "Default".
  const defaultName = $derived($defaultConfig$?.name.trim() || DEFAULT_NAME);
  const showDefaultPill = $derived(defaultName !== DEFAULT_NAME);
  // The Default configuration is the bare base provider: its status is the
  // provider's own availability check.
  const defaultStatus = $derived.by((): 'checking' | 'ready' | 'error' | 'configured' => {
    if ($providerLoadingMap$[providerId]) return 'checking';
    const status = $providerStatusMap$[providerId];
    if (!status?.available) return 'configured';
    if (status.authenticated === false) return 'error';
    return isProviderAuthenticationReady(providerId, status.authenticated) ? 'ready' : 'configured';
  });
  let deleteRequests = $state<Record<string, { profileName: string }>>({});
  let reorderRequests = $state<string[]>([]);

  const canReorder = $derived($profiles$.length > 1);
  // One reorder per provider at a time: further moves wait until the daemon answers.
  const reorderPending = $derived(
    Object.values($mutations$).some(
      (mutation) =>
        mutation.kind === 'reorder' &&
        mutation.status === 'pending' &&
        mutation.baseProviderId === providerId,
    ),
  );
  let draggedId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dragOverPosition = $state<'before' | 'after' | null>(null);
  let dragPreviewElement: HTMLElement | null = null;
  let reorderAnnouncement = $state('');

  onDestroy(() => handleDragEnd());

  const deletingIds = $derived(
    new Set(
      Object.keys(deleteRequests)
        .map((id) => $mutations$[id])
        .filter((mutation) => mutation?.status === 'pending')
        .map((mutation) => mutation!.profileId),
    ),
  );

  $effect(() => {
    for (const [id, { profileName }] of Object.entries(deleteRequests)) {
      const outcome = $mutations$[id];
      if (!outcome || outcome.status === 'pending') continue;
      appStore.dispatch(providerProfileMutationDismissed(id));
      const { [id]: _done, ...rest } = deleteRequests;
      deleteRequests = rest;
      if (outcome.status === 'success') {
        notify.success(m.settings_providerProfiles_removed_label({ name: profileName }));
      } else if (outcome.failure?.kind === 'inUse') {
        notify.error(m.settings_providerProfiles_cannotRemove_label({ name: profileName }), {
          description: describeInUse(outcome.failure.inUse),
        });
      } else if (outcome.failure?.kind !== 'notFound') {
        notify.error(m.settings_providerProfiles_removeFailed_error({ name: profileName }));
      }
    }
  });

  $effect(() => {
    // Only once the store has recorded and settled it (the store updates after dispatch).
    const settled = reorderRequests.filter((id) => {
      const outcome = $mutations$[id];
      return outcome !== undefined && outcome.status !== 'pending';
    });
    if (settled.length === 0) return;
    reorderRequests = reorderRequests.filter((id) => !settled.includes(id));
    for (const id of settled) {
      const outcome = $mutations$[id]!;
      appStore.dispatch(providerProfileMutationDismissed(id));
      // The saga re-reads the daemon's list; its saved order replaces ours.
      if (outcome.status === 'failure')
        notify.error(m.settings_providerProfiles_reorderFailed_error());
    }
  });

  function reorderProfile(
    profileId: string,
    targetId: string,
    position: 'before' | 'after' = 'before',
  ) {
    if (reorderPending) return;
    const ids = $profiles$.map((profile) => profile.id);
    const sourceIndex = ids.indexOf(profileId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    let insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
    ids.splice(sourceIndex, 1);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    if (insertionIndex === sourceIndex) return;
    ids.splice(insertionIndex, 0, profileId);
    const requestId = crypto.randomUUID();
    reorderRequests = [...reorderRequests, requestId];
    appStore.dispatch(
      providerProfileReorderRequested({ requestId, baseProviderId: providerId, profileIds: ids }),
    );
    const profile = $profiles$.find(({ id }) => id === profileId);
    if (profile) {
      reorderAnnouncement = m.settings_providerProfiles_reorderAnnouncement({
        name: profile.name,
        position: insertionIndex + 1,
      });
    }
  }

  function handleReorderKeydown(event: KeyboardEvent, profileId: string) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (reorderPending) return;
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const index = $profiles$.findIndex(({ id }) => id === profileId);
    const target = $profiles$[index + direction];
    if (target) reorderProfile(profileId, target.id, direction === -1 ? 'before' : 'after');
  }

  function handleDragStart(event: DragEvent, profileId: string) {
    if (reorderPending) {
      event.preventDefault();
      return;
    }
    draggedId = profileId;
    dragOverId = null;
    dragOverPosition = null;
    if (!event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', profileId);
    event.dataTransfer.effectAllowed = 'move';
    const row = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(
      '[data-profile-id]',
    );
    if (row && typeof event.dataTransfer.setDragImage === 'function') {
      const rect = row.getBoundingClientRect();
      const offset = (coordinate: number, start: number, size: number) =>
        Number.isFinite(coordinate) && size > 0 && coordinate >= start && coordinate <= start + size
          ? coordinate - start
          : size / 2;
      dragPreviewElement?.remove();
      dragPreviewElement = row.cloneNode(true) as HTMLElement;
      dragPreviewElement.removeAttribute('data-profile-id');
      dragPreviewElement.removeAttribute('data-testid');
      dragPreviewElement.setAttribute('aria-hidden', 'true');
      Object.assign(dragPreviewElement.style, {
        position: 'fixed',
        left: '-10000px',
        top: '-10000px',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        backgroundColor: 'hsl(var(--card))',
      });
      document.body.append(dragPreviewElement);
      event.dataTransfer.setDragImage(
        dragPreviewElement,
        offset(event.clientX, rect.left, rect.width),
        offset(event.clientY, rect.top, rect.height),
      );
    }
  }

  function dropPosition(event: DragEvent, row: HTMLElement): 'before' | 'after' {
    const rect = row.getBoundingClientRect();
    const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top;
    return clientY <= rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function handleDragOver(event: DragEvent, profileId: string) {
    if (!draggedId) return;
    if (draggedId === profileId) {
      dragOverId = null;
      dragOverPosition = null;
      return;
    }
    event.preventDefault();
    dragOverId = profileId;
    dragOverPosition = dropPosition(event, event.currentTarget as HTMLElement);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent, targetId: string) {
    if (!draggedId) return;
    event.preventDefault();
    const position =
      dragOverId === targetId && dragOverPosition
        ? dragOverPosition
        : dropPosition(event, event.currentTarget as HTMLElement);
    reorderProfile(draggedId, targetId, position);
    handleDragEnd();
  }

  function handleDragEnd() {
    draggedId = null;
    dragOverId = null;
    dragOverPosition = null;
    dragPreviewElement?.remove();
    dragPreviewElement = null;
  }

  function openEdit(profile: ProviderProfile) {
    editing = profile;
    dialogOpen = true;
  }

  async function remove(profile: ProviderProfile) {
    const reason = selectProviderInUseReasons.select(appStore.state)[profile.providerRef];
    if (reason) {
      notify.error(m.settings_providerProfiles_cannotRemove_label({ name: profile.name }), {
        description: reason,
      });
      return;
    }
    const confirmed = await confirm({
      title: m.settings_providerProfiles_removeTitle_label({ name: profile.name }),
      description: m.settings_providerProfiles_remove_description(),
      confirmLabel: m.settings_providerProfiles_remove_label(),
      destructive: true,
    });
    if (!confirmed) return;
    const requestId = crypto.randomUUID();
    deleteRequests = { ...deleteRequests, [requestId]: { profileName: profile.name } };
    appStore.dispatch(providerProfileDeleteRequested({ requestId, profileId: profile.id }));
  }
</script>

{#if $profiles$.length > 0 || $loadStatus$ === 'failure'}
  <section
    class="mt-3 ml-9 space-y-2"
    aria-label={m.settings_providerProfiles_section_ariaLabel({ provider: providerName })}
    data-testid={`provider-profiles-${providerId}`}
  >
    {#if $loadStatus$ === 'failure' && $profiles$.length === 0}
      <div class="flex items-center gap-2 type-caption text-danger">
        <span>{m.settings_providerProfiles_loadFailed_error()}</span>
        <Button
          size="xs"
          variant="ghost"
          onclick={() => appStore.dispatch(providerProfilesRequested())}
        >
          {m.settings_providers_tryAgain()}
        </Button>
      </div>
    {/if}

    {#if $profiles$.length > 0}
      <ul class="divide-y divide-border rounded-lg border border-border">
        <li class="relative px-3 py-2" data-testid="provider-default-row">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              {#if canReorder}
                <!-- Keeps the name aligned with the reorderable rows' handles. -->
                <span class="-ml-1.5 size-6 shrink-0" aria-hidden="true"></span>
              {/if}
              <span class="truncate type-body text-foreground" title={defaultName}
                >{defaultName}</span
              >
              {#if showDefaultPill}
                <span
                  class="shrink-0 rounded-full bg-muted px-2 py-0.5 type-caption text-subtle"
                  data-testid="provider-profile-default-badge"
                >
                  {DEFAULT_NAME}
                </span>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2 type-caption">
              {@render statusLabel(defaultStatus)}
              <Menu.Root>
                <Menu.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="ghost-light"
                      size="icon-xs"
                      aria-label={m.settings_providerProfiles_actions_ariaLabel({
                        name: defaultName,
                      })}
                    >
                      <KebabIcon class="size-3.5" />
                    </Button>
                  {/snippet}
                </Menu.Trigger>
                <Menu.Content
                  align="end"
                  aria-label={m.settings_providerProfiles_actions_ariaLabel({ name: defaultName })}
                >
                  <div class={offersFastMode && providerId !== 'codex' ? 'w-64' : 'w-56'}>
                    {#if offersFastMode}
                      <ProviderFastModeMenuItems providerRef={providerId} />
                      <Menu.Separator />
                    {/if}
                    <Menu.Item
                      class="cursor-pointer text-foreground"
                      onSelect={() => {
                        defaultDialogOpen = true;
                      }}
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center">
                        <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
                      </span>
                      {m.settings_providerProfiles_edit_label()}
                    </Menu.Item>
                    <Menu.Item
                      class="cursor-pointer text-foreground"
                      disabled={defaultStatus === 'checking'}
                      onSelect={() => appStore.dispatch(checkSingleProviderRequested(providerId))}
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center">
                        <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
                      </span>
                      {m.settings_providers_recheck_label()}
                    </Menu.Item>
                  </div>
                </Menu.Content>
              </Menu.Root>
            </div>
          </div>
        </li>
        {#each $profiles$ as profile (profile.id)}
          {@const status = $status$[profile.id] ?? 'configured'}
          {@const activation = $activation$[profile.id]}
          {@const inUseReason = $inUse$[profile.providerRef] ?? null}
          {@const deleting = deletingIds.has(profile.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions (keyboard reordering is on the nested handle) -->
          <li
            class="relative px-3 py-2 transition-colors data-[dragging=true]:opacity-60"
            data-testid="provider-profile-row"
            data-profile-id={profile.id}
            data-dragging={draggedId === profile.id || undefined}
            ondragover={canReorder ? (event) => handleDragOver(event, profile.id) : undefined}
            ondrop={canReorder ? (event) => handleDrop(event, profile.id) : undefined}
          >
            {#if dragOverId === profile.id && dragOverPosition}
              <div
                data-profile-insertion-line
                data-position={dragOverPosition}
                class="pointer-events-none absolute right-2 left-2 z-10 h-0.5 rounded-full bg-primary"
                class:top-0={dragOverPosition === 'before'}
                class:bottom-0={dragOverPosition === 'after'}
              ></div>
            {/if}
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                {#if canReorder}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    draggable={reorderPending ? 'false' : 'true'}
                    aria-disabled={reorderPending || undefined}
                    class="-ml-1.5 flex size-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                    aria-label={m.settings_providerProfiles_reorder_ariaLabel({
                      name: profile.name,
                    })}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    disabled={deleting}
                    ondragstart={(event: DragEvent) => handleDragStart(event, profile.id)}
                    ondragend={handleDragEnd}
                    onkeydown={(event: KeyboardEvent) => handleReorderKeydown(event, profile.id)}
                  >
                    <Fa icon={faGripLines} class="size-3" />
                  </Button>
                {/if}
                <span class="truncate type-body text-foreground" title={profile.name}
                  >{profile.name}</span
                >
                {#if profile.backup === true}
                  <span
                    class="shrink-0 rounded-full bg-muted px-2 py-0.5 type-caption text-subtle"
                    data-testid="provider-profile-backup-badge"
                  >
                    {m.settings_providerProfiles_backupBadge_label()}
                  </span>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-2 type-caption">
                {@render statusLabel(status)}
                <Menu.Root>
                  <Menu.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost-light"
                        size="icon-xs"
                        disabled={deleting}
                        aria-label={m.settings_providerProfiles_actions_ariaLabel({
                          name: profile.name,
                        })}
                      >
                        <KebabIcon class="size-3.5" />
                      </Button>
                    {/snippet}
                  </Menu.Trigger>
                  <Menu.Content
                    align="end"
                    aria-label={m.settings_providerProfiles_actions_ariaLabel({
                      name: profile.name,
                    })}
                  >
                    <div class={offersFastMode && providerId !== 'codex' ? 'w-64' : 'w-56'}>
                      {#if offersFastMode}
                        <ProviderFastModeMenuItems providerRef={profile.providerRef} />
                        <Menu.Separator />
                      {/if}
                      <Menu.Item
                        class="cursor-pointer text-foreground"
                        onSelect={() => openEdit(profile)}
                      >
                        <span class="flex size-4 shrink-0 items-center justify-center">
                          <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
                        </span>
                        {m.settings_providerProfiles_edit_label()}
                      </Menu.Item>
                      <Menu.Item
                        class="cursor-pointer text-foreground"
                        disabled={status === 'checking'}
                        onSelect={() =>
                          appStore.dispatch(providerProfileCheckRequested(profile.id))}
                      >
                        <span class="flex size-4 shrink-0 items-center justify-center">
                          <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
                        </span>
                        {m.settings_providers_recheck_label()}
                      </Menu.Item>
                      <Menu.Separator />
                      <Menu.Item
                        class="cursor-pointer text-foreground"
                        title={inUseReason ?? undefined}
                        onSelect={() => void remove(profile)}
                      >
                        <span class="flex size-4 shrink-0 items-center justify-center">
                          <Fa icon={faTrash} class="size-3.5 text-muted-foreground" />
                        </span>
                        {m.settings_providerProfiles_remove_label()}
                      </Menu.Item>
                      {#if inUseReason}
                        <p
                          class="px-2 py-1.5 type-caption whitespace-pre-line text-muted-foreground"
                        >
                          {m.settings_providerProfiles_removeBlocked_description({
                            reasons: inUseReason,
                          })}
                        </p>
                      {/if}
                    </div>
                  </Menu.Content>
                </Menu.Root>
              </div>
            </div>
            {#if activation && activation.runningProcesses > 0}
              <div
                class="mt-1 flex items-start justify-between gap-2 type-caption text-warning-ink"
                data-testid="provider-profile-earlier-settings"
              >
                <span>{runningProcessesNotice(activation.runningProcesses, $appOwned$)}</span>
                <Button
                  size="icon-xs"
                  variant="ghost-light"
                  aria-label={m.settings_providerProfiles_dismissNotice_ariaLabel()}
                  onclick={() => appStore.dispatch(providerProfileActivationDismissed(profile.id))}
                >
                  <Fa icon={faXmark} class="size-3" />
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      {#if canReorder}
        <span class="sr-only" aria-live="polite">{reorderAnnouncement}</span>
      {/if}
    {/if}
  </section>
{/if}

<ProviderProfileDialog bind:open={dialogOpen} {providerId} {providerName} profile={editing} />
<ProviderProfileDialog
  bind:open={defaultDialogOpen}
  {providerId}
  {providerName}
  isDefault
  defaultConfig={$defaultConfig$}
  defaultsLoad={$loadStatus$}
/>

{#snippet statusLabel(status: string)}
  <span
    role="status"
    class="flex items-center gap-1 {status === 'error' ? 'text-warning-ink' : 'text-subtle'}"
    data-profile-status={status}
  >
    {#if status === 'checking'}
      <IntentMarkLoader size={12} class="text-muted-foreground" />
      {m.settings_providerProfiles_statusChecking_label()}
    {:else if status === 'ready'}
      <Fa icon={faCheck} class="size-3 text-success" />
      {m.settings_providerProfiles_statusReady_label()}
    {:else if status === 'error'}
      <Fa icon={faTriangleExclamation} class="size-3" />
      {m.settings_providerProfiles_statusError_label()}
    {:else}
      {m.settings_providerProfiles_statusConfigured_label()}
    {/if}
  </span>
{/snippet}
