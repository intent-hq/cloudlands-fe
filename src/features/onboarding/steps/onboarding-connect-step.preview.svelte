<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { ProfileProvider } from '$lib/provider-profile-kinds';
  import type { ConnectKind } from '../utils/onboarding-connect-step';

  type Scene = 'empty' | 'invalid' | 'valid' | 'saving' | 'saved' | 'saveFailed';
  interface Props {
    provider?: ProfileProvider;
    kind?: ConnectKind;
    scene?: Scene;
  }

  const SCENES: Scene[] = ['empty', 'invalid', 'valid', 'saving', 'saved', 'saveFailed'];
  const states = Object.fromEntries(
    (['claude', 'codex'] as const).flatMap((provider) =>
      (['token', 'apiKey'] as const).flatMap((kind) =>
        SCENES.map((scene) => [
          `${provider}-${kind === 'apiKey' ? 'api-key' : 'token'}-${scene.replace('saveFailed', 'save-failed')}`,
          { props: { provider, kind, scene } },
        ]),
      ),
    ),
  ) as Record<string, { props: Props }>;

  /** Onboarding "Connect {provider}" on an orchestrator: kind × paste state. */
  export const preview = definePreview<Props>({
    id: 'onboarding-connect-step',
    title: 'Onboarding: connect provider',
    defaultState: 'claude-token-empty',
    states,
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
  import {
    providerProfileSetupChanged,
    providerProfileSetupDismissed,
    providerProfilesLoaded,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import type { ProviderProfile } from '$shared/provider-profiles';
  import OnboardingConnectStep from './OnboardingConnectStep.svelte';

  let { provider = 'claude', kind = 'token', scene = 'empty' }: Props = $props();

  // i18n-ignore (fake preview credentials, never real)
  const SECRETS: Record<ProfileProvider, Record<ConnectKind, string>> = {
    claude: {
      token: 'sk-ant-oat01-fakefakefakefakefakefake',
      apiKey: 'sk-ant-api03-fakefakefakefakefakefake',
    },
    codex: {
      token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.ZmFrZQ',
      apiKey: 'sk-proj-fakefakefakefakefakefake',
    },
  };
  const SETUP_ID = 'preview-connect-setup';

  const seeded = untrack(() => ({ provider, kind, scene }));
  const base = seeded.provider === 'claude' ? 'claude-code' : 'codex';
  const previousDefault = appStore.state.model.defaultProviderId;
  const previousRevision = appStore.state.providerSettings.profiles.revision;
  const savedProfile: ProviderProfile = {
    id: 'pconnect00001',
    providerRef: `${base}@pconnect00001`, // i18n-ignore (fake profile reference)
    baseProviderId: base,
    name: seeded.provider === 'claude' ? 'Claude subscription' : 'OpenAI API key', // i18n-ignore (fake preview data)
    env:
      seeded.provider === 'claude'
        ? seeded.kind === 'token'
          ? [{ key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'set', value: '********' }]
          : [{ key: 'ANTHROPIC_API_KEY', kind: 'set', value: '********' }]
        : seeded.kind === 'token'
          ? [{ key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: '********' }]
          : [{ key: 'CODEX_API_KEY', kind: 'set', value: '********' }],
    settingsFingerprint: 'fp-connect',
    createdAt: '2026-11-18T10:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
  };
  appStore.dispatch(
    providerProfilesLoaded(seeded.scene === 'saved' ? [savedProfile] : [], previousRevision + 1),
  );
  appStore.dispatch(
    hydrateDefaultProvider(seeded.scene === 'saved' ? savedProfile.providerRef : base),
  );
  if (seeded.scene === 'saving')
    appStore.dispatch(providerProfileSetupChanged(SETUP_ID, { phase: 'saving' }));
  if (seeded.scene === 'saveFailed') {
    appStore.dispatch(
      providerProfileSetupChanged(SETUP_ID, {
        phase: 'failed',
        failure: { kind: 'saveFailed', failure: { kind: 'other' } },
      }),
    );
  }

  let secret = $state(
    seeded.scene === 'invalid'
      ? 'not-a-valid-secret'
      : seeded.scene === 'empty' || seeded.scene === 'saved'
        ? ''
        : SECRETS[seeded.provider][seeded.kind],
  );
  let setupId = $state<string | null>(
    seeded.scene === 'saving' || seeded.scene === 'saveFailed' ? SETUP_ID : null,
  );
  let selectedKind = $state<ConnectKind>(seeded.kind);

  onDestroy(() => {
    appStore.dispatch(providerProfileSetupDismissed(SETUP_ID));
    appStore.dispatch(providerProfilesLoaded([], previousRevision + 2));
    appStore.dispatch(hydrateDefaultProvider(previousDefault));
  });
</script>

<div class="w-full max-w-4xl p-10" data-onboarding-connect-preview>
  <OnboardingConnectStep
    {provider}
    bind:kind={selectedKind}
    bind:secret
    bind:setupId
    onContinue={() => {}}
  />
</div>
