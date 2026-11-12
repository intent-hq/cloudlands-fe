<script lang="ts">
  /**
   * The Default configuration's "Use on remote machines" in a provider's ⋯
   * menu (saved with `providers.profiles.updateDefault`). A remote machine
   * that is signed in to the provider uses its own sign-in either way; one
   * that isn't gets the Default's settings only when it is marked. Shown on
   * the Default row, or on the provider row when the Default is the only
   * profile.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { Menu } from '$lib/components/patterns/settings/custom-controls';
  import Fa from 'svelte-fa';
  import { faGlobe } from '@fortawesome/free-solid-svg-icons';
  import { notify } from '$lib/components/patterns/notify';
  import ProviderMenuHelp from './ProviderMenuHelp.svelte';
  import ProviderMenuHelpText from './ProviderMenuHelpText.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerDefaultUpdateRequested,
    providerProfileMutationDismissed,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectProviderDefaultConfig,
    selectProviderProfileMutations,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';

  interface Props {
    providerId: string;
  }

  let { providerId }: Props = $props();

  // svelte-ignore state_referenced_locally
  const defaultConfig$ = selectProviderDefaultConfig(providerId);
  const mutations$ = selectProviderProfileMutations();

  let pendingId = $state<string | null>(null);
  const saving = $derived(pendingId !== null && $mutations$[pendingId]?.status === 'pending');
  const marked = $derived($defaultConfig$?.remoteCompatible === true);
  /** A Default that sets an account folder can't be marked. */
  const folderKeys = $derived(
    $defaultConfig$?.remoteIncompatibility?.reason === 'account-folder'
      ? $defaultConfig$.remoteIncompatibility.keys
      : null,
  );
  const markDescriptionId = $derived(`remote-default-description-${providerId}`);
  const markDescription = $derived(
    folderKeys
      ? m.settings_providerRemote_accountFolderBlocked_description({ keys: folderKeys.join(', ') })
      : m.settings_providerRemote_defaultUseOnRemote_description(),
  );

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
  <span class="flex min-w-0 flex-1 items-start gap-1.5">
    {m.settings_providerRemote_useOnRemote_label()}
    <ProviderMenuHelp text={markDescription} />
  </span>
</Menu.CheckboxItem>
<ProviderMenuHelpText id={markDescriptionId} text={markDescription} />
