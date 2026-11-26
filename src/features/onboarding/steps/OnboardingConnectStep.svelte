<script lang="ts">
  /**
   * Onboarding step on an orchestrator: paste the chosen provider's token or
   * API key. The orchestrator runs no provider, so the key's format is the
   * whole check. Continue saves it as a profile (the same create path and env
   * table as Settings → Add profile) and makes that profile the provider's
   * default; machines receive it when an agent starts there. Coming back
   * shows the saved profile with Replace.
   */
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { faKey, faTicket } from '@fortawesome/free-solid-svg-icons';
  import { onMount, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import ProfileSecretFields from '$lib/components/settings/profile-kinds/ProfileSecretFields.svelte';
  import {
    kindCardDescription,
    secretKindLabel,
    secretShapeError,
  } from '$lib/components/settings/profile-kinds/profile-kind-copy';
  import {
    baseProviderIdFor,
    buildCreatePayload,
    buildUpdateEnv,
    detectProfileKind,
    type ProfileProvider,
  } from '$lib/provider-profile-kinds';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerProfileSecretEditRequested,
    providerProfileSecretSetupRequested,
    providerProfileSetupDismissed,
    providerProfilesRequested,
    providerSettingsSessionClosed,
    providerSettingsSessionOpened,
    setActiveProvider,
    setProviderEnabled,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
    selectActiveProviderId,
    selectProviderDefaultConfigs,
    selectProviderProfileSetups,
    selectProviderProfilesForBase,
    selectProviderProfilesLoadStatus,
    selectProviderSettingsSessionRequests,
  } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    canContinueConnect,
    connectKindsFor,
    connectSecretIssue,
    savedConnectProfile,
    uniqueProfileName,
    type ConnectKind,
  } from '../utils/onboarding-connect-step';

  interface Props {
    provider: ProfileProvider;
    /** Token (preselected) or API key. */
    kind?: ConnectKind;
    secret?: string;
    /** The profile save in flight (`providerProfiles` setup id). */
    setupId?: string | null;
    /** Out: a save is in flight (the page holds Back until it settles). */
    busy?: boolean;
    /** Advance once the profile is saved and selected. */
    onContinue: () => void;
  }

  let {
    provider,
    kind = $bindable(untrack(() => connectKindsFor(provider)[0])),
    secret = $bindable(''),
    setupId = $bindable(null),
    busy = $bindable(false),
    onContinue,
  }: Props = $props();

  const baseProviderId = $derived(baseProviderIdFor(provider));
  const activeProviderId$ = selectActiveProviderId();
  const profiles$ = selectProviderProfilesForBase(untrack(() => baseProviderIdFor(provider)));
  const defaults$ = selectProviderDefaultConfigs();
  const setups$ = selectProviderProfileSetups();

  const saved = $derived(savedConnectProfile($activeProviderId$, baseProviderId, $profiles$));
  const savedKind = $derived(saved ? detectProfileKind(provider, saved.env) : undefined);

  let replacing = $state(false);
  let saveFailed = $state(false);
  // Making the saved profile the default is a settings write of its own:
  // advance only once it succeeds, and retry just that write on failure.
  const sessionId = crypto.randomUUID();
  const sessionRequests$ = selectProviderSettingsSessionRequests(sessionId);
  let selecting = $state<{ requestId: string; providerRef: string } | null>(null);
  let unselectedRef = $state<string | null>(null);
  /** Continue retries only the failed default write until a new value is pasted or kind chosen. */
  const retriesDefault = $derived(unselectedRef !== null && secret.trim() === '');

  onMount(() => {
    appStore.dispatch(providerSettingsSessionOpened(sessionId));
    if (selectProviderProfilesLoadStatus.select(appStore.state) !== 'success')
      appStore.dispatch(providerProfilesRequested());
    return () => {
      if (setupId) appStore.dispatch(providerProfileSetupDismissed(setupId));
      appStore.dispatch(providerSettingsSessionClosed(sessionId));
    };
  });

  function selectProfile(providerRef: string) {
    const requestId = crypto.randomUUID();
    selecting = { requestId, providerRef };
    unselectedRef = null;
    appStore.dispatch(setProviderEnabled({ providerId: baseProviderId, enabled: true }));
    appStore.dispatch(setActiveProvider(providerRef, { id: requestId, sessionId }));
  }

  $effect(() => {
    const pending = selecting;
    if (!pending) return;
    const request = $sessionRequests$.find((item) => item.id === pending.requestId);
    if (!request || request.status === 'pending') return;
    untrack(() => {
      selecting = null;
      if (request.status === 'success') {
        onContinue();
        return;
      }
      unselectedRef = pending.providerRef;
      saveFailed = true;
    });
  });

  // Back keeps the choice: reopen on the saved profile's kind.
  let kindRestored = false;
  $effect(() => {
    if (kindRestored || !savedKind) return;
    kindRestored = true;
    if (
      (savedKind === 'token' || savedKind === 'apiKey') &&
      connectKindsFor(provider).includes(savedKind)
    )
      kind = savedKind;
  });

  /** The saved profile stands only for its own kind; another kind replaces it. */
  const showsSaved = $derived(!!saved && savedKind === kind);
  const issue = $derived(connectSecretIssue(provider, kind, secret));
  const setup = $derived(setupId ? $setups$[setupId] : undefined);
  const saving = $derived(
    selecting !== null || (!!setup && (setup.phase === 'saving' || setup.phase === 'checkingKey')),
  );
  $effect(() => {
    busy = saving;
  });
  const canContinue = $derived(
    (retriesDefault && !saving) ||
      canContinueConnect({ saved: showsSaved, replacing, issue, busy: saving }),
  );
  const secretError = $derived(issue === 'shape' ? secretShapeError(provider, kind) : undefined);

  function cardTitle(item: ConnectKind): string {
    if (item === 'apiKey') return m.settings_providerProfileKinds_apiKey_label();
    if (provider === 'claude') return m.onboarding_connect_claudeToken_label();
    if (provider === 'codex') return m.onboarding_connect_codexToken_label();
    return secretKindLabel(provider, item);
  }

  function cardDescription(item: ConnectKind): string {
    if (provider === 'claude') {
      return item === 'token'
        ? m.onboarding_connect_claudeToken_description()
        : m.onboarding_connect_claudeApiKey_description();
    }
    if (provider === 'codex' && item === 'apiKey')
      return m.onboarding_connect_codexApiKey_description();
    return kindCardDescription(provider, item);
  }

  const cards = $derived<
    { kind: ConnectKind; icon: IconDefinition; title: string; description: string }[]
  >(
    connectKindsFor(provider).map((item) => ({
      kind: item,
      icon: item === 'token' ? faTicket : faKey,
      title: cardTitle(item),
      description: cardDescription(item),
    })),
  );

  /** The new profile's name: what it signs in with. */
  function connectProfileName(): string {
    switch (provider) {
      case 'claude':
        return kind === 'token'
          ? m.onboarding_connect_claudeTokenProfile_name()
          : m.onboarding_connect_claudeApiKeyProfile_name();
      case 'codex':
        return kind === 'token'
          ? m.onboarding_connect_codexTokenProfile_name()
          : m.onboarding_connect_codexApiKeyProfile_name();
      case 'grok':
        return m.onboarding_connect_grokApiKeyProfile_name();
      case 'droid':
        return m.onboarding_connect_droidApiKeyProfile_name();
      case 'cursor':
        return m.onboarding_connect_cursorApiKeyProfile_name();
      case 'dsh':
        return m.onboarding_connect_dshApiKeyProfile_name();
      case 'auggie':
        return m.onboarding_connect_auggieTokenProfile_name();
    }
  }

  function profileName(): string {
    const name = connectProfileName();
    const taken = $profiles$.filter((p) => p.id !== saved?.id).map((p) => p.name);
    const defaultName = $defaults$[baseProviderId]?.name;
    return uniqueProfileName(name, defaultName ? [...taken, defaultName] : taken);
  }

  function choose(next: ConnectKind) {
    if (saving || next === kind) return;
    kind = next;
    secret = '';
    replacing = false;
    saveFailed = false;
    unselectedRef = null;
  }

  /** Continue: keep the saved profile, or save the pasted secret first. */
  export function submit() {
    if (retriesDefault && unselectedRef && !saving) {
      saveFailed = false;
      selectProfile(unselectedRef);
      return;
    }
    if (!canContinueConnect({ saved: showsSaved, replacing, issue, busy: saving })) return;
    if (showsSaved && !replacing) {
      onContinue();
      return;
    }
    saveFailed = false;
    if (setupId) appStore.dispatch(providerProfileSetupDismissed(setupId));
    const id = crypto.randomUUID();
    setupId = id;
    const secretField = kind === 'apiKey' ? { apiKey: secret } : { token: secret };
    if (saved) {
      appStore.dispatch(
        providerProfileSecretEditRequested({
          setupId: id,
          profileId: saved.id,
          name: profileName(),
          env: buildUpdateEnv(kind, provider, saved.env, secretField),
        }),
      );
      return;
    }
    const payload = buildCreatePayload(kind, provider, { name: profileName(), ...secretField });
    appStore.dispatch(
      providerProfileSecretSetupRequested({
        setupId: id,
        baseProviderId,
        name: payload.name,
        backup: false,
        env: payload.env ?? [],
      }),
    );
  }

  // Saved: select the profile as the provider's default, then advance.
  $effect(() => {
    const current = setup;
    if (!current) return;
    untrack(() => {
      if (current.phase === 'failed') {
        saveFailed = true;
        appStore.dispatch(providerProfileSetupDismissed(current.id));
        setupId = null;
        return;
      }
      if (current.phase !== 'keySaved' && current.phase !== 'keyWorks') return;
      const profile = $profiles$.find((item) => item.id === current.profileId);
      if (!profile) return;
      appStore.dispatch(providerProfileSetupDismissed(current.id));
      setupId = null;
      secret = '';
      replacing = false;
      selectProfile(profile.providerRef);
    });
  });
</script>

<div class="max-w-2xl space-y-6" data-testid="onboarding-connect-step" data-provider={provider}>
  {#if cards.length > 1}
    <div
      class="grid grid-cols-1 gap-3 sm:grid-cols-2"
      role="radiogroup"
      aria-label={m.settings_providerProfileKinds_picker_ariaLabel()}
    >
      {#each cards as card (card.kind)}
        {@const selected = card.kind === kind}
        <Button
          variant="outline"
          role="radio"
          aria-checked={selected}
          disabled={saving}
          truncateLabel={false}
          labelClass="flex items-start gap-3"
          class="h-auto justify-start gap-3 whitespace-normal p-4 text-left {selected
            ? 'border-foreground bg-muted'
            : ''}"
          data-testid={`onboarding-connect-kind-${card.kind}`}
          onclick={() => choose(card.kind)}
        >
          <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <Fa icon={card.icon} class="size-4 text-foreground" />
          </span>
          <span class="flex min-w-0 flex-col gap-1">
            <span class="type-body font-medium! text-foreground">{card.title}</span>
            <span class="type-caption text-muted-foreground">{card.description}</span>
          </span>
        </Button>
      {/each}
    </div>
  {:else if cards[0]}
    <!-- One kind (Grok, Droid, Cursor, Auggie): no choice to make, only its note. -->
    <p class="type-body text-muted-foreground" data-testid="onboarding-connect-kind-note">
      {cards[0].description}
    </p>
  {/if}

  {#key kind}
    <ProfileSecretFields
      {provider}
      {kind}
      mode={showsSaved ? 'edit' : 'add'}
      bind:secret
      secretSaved={showsSaved}
      bind:replacing
      {secretError}
      disabled={saving}
      keyCheck={false}
      pasteStep={false}
      customEndpoint={false}
    />
  {/key}

  {#if showsSaved && !replacing}
    <p class="type-caption text-muted-foreground" data-testid="onboarding-connect-saved">
      {m.onboarding_connect_saved_description({ name: saved?.name ?? '' })}
    </p>
  {/if}
  {#if saveFailed}
    <p class="type-body text-danger" role="alert">
      {m.settings_providerProfiles_saveFailed_error()}
    </p>
  {/if}

  <div class="flex flex-col items-start gap-2 pt-3">
    <Button
      class="group/button"
      size="xl"
      variant={canContinue ? 'primary' : 'outline'}
      disabled={!canContinue}
      loading={saving}
      onclick={submit}
      data-testid="onboarding-connect-continue"
    >
      {saving ? m.onboarding_connect_saving_label() : m.onboarding_connect_continue_label()}
      {#if canContinue}
        <span class="ml-1 opacity-50">⌘↵</span>
      {/if}
    </Button>
  </div>
</div>
