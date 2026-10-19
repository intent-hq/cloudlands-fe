<script lang="ts">
  /**
   * Named profiles of one installed provider (§5.54), shown inside its
   * Settings → Providers row: honest per-profile status, rename/edit, and
   * removal that is blocked while saved selections still use the profile.
   */
  import {
    faArrowsRotate,
    faCheck,
    faPen,
    faPlus,
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
  import { describeInUse, runningProcessesNotice } from '$features/settings/profile-env-form';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileActivationDismissed,
    providerProfileCheckRequested,
    providerProfileDeleteRequested,
    providerProfileMutationDismissed,
    providerProfilesRequested,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderProfileActivationMap,
    selectProviderProfileMutations,
    selectProviderProfilesForBase,
    selectProviderProfilesLoadStatus,
    selectProviderProfileStatusMap,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectFastModeSupportedProviders } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
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
  const defaultProviderId$ = selectActiveProviderId();
  const appOwned$ = selectIsDaemonAppOwned();
  const fastModeProviders$ = selectFastModeSupportedProviders();
  // Each profile has its own Fast mode / service tier, offered exactly when
  // the base provider's is (this whole section is already Labs-gated).
  const offersFastMode = $derived($fastModeProviders$.includes(providerId));

  let dialogOpen = $state(false);
  let editing = $state<ProviderProfile | undefined>(undefined);
  let deleteRequests = $state<Record<string, { profileName: string }>>({});

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

  function openAdd() {
    editing = undefined;
    dialogOpen = true;
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
      {#each $profiles$ as profile (profile.id)}
        {@const status = $status$[profile.id] ?? 'configured'}
        {@const activation = $activation$[profile.id]}
        {@const inUseReason = $inUse$[profile.providerRef] ?? null}
        {@const deleting = deletingIds.has(profile.id)}
        <li class="px-3 py-2" data-testid="provider-profile-row" data-profile-id={profile.id}>
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate type-body text-foreground" title={profile.name}
                >{profile.name}</span
              >
              {#if $defaultProviderId$ === profile.providerRef}
                <span class="rounded-full bg-muted px-2 py-0.5 type-caption text-subtle">
                  {m.settings_providers_default()}
                </span>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2 type-caption">
              <span
                role="status"
                class="flex items-center gap-1 {status === 'error'
                  ? 'text-warning-ink'
                  : 'text-subtle'}"
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
                  aria-label={m.settings_providerProfiles_actions_ariaLabel({ name: profile.name })}
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
                      onSelect={() => appStore.dispatch(providerProfileCheckRequested(profile.id))}
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
                      <p class="px-2 py-1.5 type-caption whitespace-pre-line text-muted-foreground">
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
  {/if}

  <Button size="xs" variant="secondary" onclick={openAdd}>
    <Fa icon={faPlus} class="mr-1 size-3" />
    {m.settings_providerProfiles_add_label()}
  </Button>
</section>

<ProviderProfileDialog bind:open={dialogOpen} {providerId} {providerName} profile={editing} />
