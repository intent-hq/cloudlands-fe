<script lang="ts">
  /**
   * The Default configuration's remote options in a provider's ⋯ menu:
   * "Use on remote machines" (the Default's mark, saved with
   * `providers.profiles.updateDefault`) and machine sign-in
   * (`providers.remoteMachineSignIn`: an unmarked Default runs with the
   * machine's own sign-in). Shown on the Default row, or on the provider row
   * when the Default is the only profile.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import Fa from 'svelte-fa';
  import { faGlobe, faUser } from '@fortawesome/free-solid-svg-icons';
  import { notify } from '$lib/components/patterns/notify';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerDefaultUpdateRequested,
    providerProfileMutationDismissed,
    setRemoteMachineSignIn,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderDefaultConfig,
    selectProviderProfileMutations,
    selectRemoteMachineSignInSupported,
    selectRemoteMachineSignInValues,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

  interface Props {
    providerId: string;
  }

  let { providerId }: Props = $props();

  // svelte-ignore state_referenced_locally
  const defaultConfig$ = selectProviderDefaultConfig(providerId);
  const mutations$ = selectProviderProfileMutations();
  const machineSignIn$ = selectRemoteMachineSignInValues();
  const machineSignInSupported$ = selectRemoteMachineSignInSupported();

  let pendingId = $state<string | null>(null);
  const saving = $derived(pendingId !== null && $mutations$[pendingId]?.status === 'pending');
  const marked = $derived($defaultConfig$?.remoteCompatible === true);
  /** A Default that sets an account folder can't be marked. */
  const folderKeys = $derived(
    $defaultConfig$?.remoteIncompatibility?.reason === 'account-folder'
      ? $defaultConfig$.remoteIncompatibility.keys
      : null,
  );
  const machineSignIn = $derived($machineSignIn$[providerId] ?? true);
  const markDescriptionId = $derived(`remote-default-description-${providerId}`);
  const machineSignInDescriptionId = $derived(`remote-machine-sign-in-description-${providerId}`);

  /** Reports the outcome even after the menu closes and this component unmounts. */
  function watchOutcome(requestId: string) {
    let unsubscribe: (() => void) | undefined;
    unsubscribe = mutations$.subscribe((mutations) => {
      const outcome = mutations[requestId];
      if (!outcome || outcome.status === 'pending') return;
      queueMicrotask(() => {
        unsubscribe?.();
        appStore.dispatch(providerProfileMutationDismissed(requestId));
        if (outcome.status === 'failure')
          notify.error(m.settings_providerRemote_defaultSaveFailed_error());
      });
    });
  }

  function toggleMark(event: Event) {
    event.preventDefault();
    if (saving || !$defaultConfig$ || folderKeys) return;
    const requestId = crypto.randomUUID();
    pendingId = requestId;
    appStore.dispatch(
      providerDefaultUpdateRequested({
        requestId,
        baseProviderId: providerId,
        remoteCompatible: !marked,
      }),
    );
    watchOutcome(requestId);
  }

  function toggleMachineSignIn(event: Event) {
    event.preventDefault();
    const current = selectRemoteMachineSignInValues.select(appStore.state)[providerId] ?? true;
    appStore.dispatch(setRemoteMachineSignIn(providerId, !current));
  }
</script>

{#snippet icon(definition: typeof faGlobe)}
  <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
    <Fa icon={definition} class="size-3.5 text-muted-foreground" />
  </span>
{/snippet}

<Menu.CheckboxItem
  class="text-foreground"
  indicator="switch"
  checked={marked}
  disabled={saving || !$defaultConfig$ || folderKeys !== null}
  onSelect={toggleMark}
  aria-describedby={markDescriptionId}
  data-testid="provider-default-remote-item"
>
  {@render icon(faGlobe)}
  {m.settings_providerRemote_useOnRemote_label()}
</Menu.CheckboxItem>
<p id={markDescriptionId} class="py-1.5 ps-9 pe-2.5 type-caption {Menu.menuDescription}">
  {folderKeys
    ? m.settings_providerRemote_accountFolderBlocked_description({ keys: folderKeys.join(', ') })
    : m.settings_providerRemote_defaultUseOnRemote_description()}
</p>
{#if $machineSignInSupported$}
  <Menu.CheckboxItem
    class="text-foreground"
    indicator="switch"
    checked={machineSignIn}
    onSelect={toggleMachineSignIn}
    aria-describedby={machineSignInDescriptionId}
    data-testid="provider-remote-machine-sign-in-item"
  >
    {@render icon(faUser)}
    {m.settings_providerRemote_machineSignIn_label()}
  </Menu.CheckboxItem>
  <p id={machineSignInDescriptionId} class="py-1.5 ps-9 pe-2.5 type-caption {Menu.menuDescription}">
    {m.settings_providerRemote_machineSignIn_description()}
  </p>
{/if}
