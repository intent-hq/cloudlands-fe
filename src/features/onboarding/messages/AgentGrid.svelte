<script lang="ts">
  /**
   * AgentGrid
   *
   * Product-card style horizontal wrapping grid showing ACP providers.
   * Each card has a brand-color top area with provider logo, and a bottom
   * area with name + connection status / connect controls.
   *
   * Connected cards use their brand color (feel active).
   * Disconnected cards use grey (muted).
   */
  import { onMount } from 'svelte';
  import { invoke } from '$lib/electron-bridge';
  import { ACP_PROVIDERS, getDefaultProviderId } from '$shared/config/provider-config';
  import { AUGGIE_CHANNELS } from '$shared/ipc/channels';
  import ProviderCard from './ProviderCard.svelte';
  import type { ProviderBrandColors } from './ProviderCard.svelte';
  import { resolveOnboardingSelectedProvider } from '../utils/resolve-onboarding-selected-provider';
  import { isOnboardingProviderVisible } from '../utils/is-onboarding-provider-visible';
  import { orderOnboardingProviders } from '../utils/order-onboarding-providers';

  import { selectIsFeatureEnabled } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    setActiveProvider,
    setProviderEnabled,
  } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';

  import { createLogger } from '$lib/utils/client-logger';

  import {
    selectProviderStatusMap,
    selectProviderLoadingMap,
    selectHasCheckedOnce,
    selectNpxStatus,
  } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import {
    checkAllProvidersRequested,
    ensureProvidersChecked as ensureProvidersCheckedAction,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';

  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    /** Called when user selects a provider to start using */
    onProviderSelected?: (providerId: string) => void;
    /** Called when the availability of any provider changes */
    onAvailabilityChange?: (hasAny: boolean) => void;
    /**
     * Layout mode.
     *  - `false` (default): wrapping flex grid where cards stretch via `flex-1`
     *    to share the row in wide containers.
     *  - `true`: single-row layout with fixed-width cards. The grid sizes to
     *    its content (`w-max`) so the parent can clip/scroll horizontally
     *    via `overflow-x-auto`. Used in the workspace onboarding panel where
     *    the available width is narrower than the natural width of all cards.
     */
    horizontal?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Svelte prop used by parent
  let { onProviderSelected, onAvailabilityChange, horizontal = false }: Props = $props();

  // Reactive Redux selectors — init at component top level
  const providerStatusMap$ = selectProviderStatusMap();
  const providerLoadingMap$ = selectProviderLoadingMap();
  const hasCheckedOnce$ = selectHasCheckedOnce();
  const activeProviderId$ = selectActiveProviderId();
  const npxStatus$ = selectNpxStatus();

  /** Brand colors per provider for the card top area.
   *  `color` is the solid brand color; the gradient fades it vertically
   *  from full opacity at the top to transparent at the bottom so the
   *  dark card background shows through — matching the reference design. */
  const PROVIDER_BRAND_COLORS: Record<string, ProviderBrandColors> = {
    auggie: { color1: '#8B8BF8cc', color2: '#8B8BF8' },
    'claude-code': { color1: '#D97757', color2: '#D97757' },
    codex: { color1: '#CBE6FF', color2: '#DDBEFC', isLight: true },
    opencode: { color1: '#000', color2: '#1E1E1E' },
    droid: { color1: '#F0822F', color2: '#E55A2B' },
    grok: { color1: '#000000', color2: '#252525' },
    cortex: { color1: '#FFA2A3', color2: '#FFA2A3' },
  };

  const DEFAULT_BRAND: ProviderBrandColors = { color1: '#555', color2: '#555' };

  /** Fisher-Yates shuffle for provider list randomization */
  function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /** Short descriptions for each provider */
  const PROVIDER_DESCRIPTIONS: Record<string, string> = {};

  /**
   * Install command + docs URL for each provider.
   * Shown on the card so users can copy/run them without leaving the app.
   * Only the install command is surfaced — users uninstall via their package
   * manager directly when they want to remove a provider.
   */
  const PROVIDER_METADATA: Record<
    string,
    { installCommand: string; loginCommand?: string; docsUrl: string }
  > = {
    auggie: {
      installCommand: 'npm install -g @augmentcode/auggie',
      loginCommand: 'auggie login',
      docsUrl: 'https://docs.augmentcode.com/cli/overview',
    },
    'claude-code': {
      installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
      // The Claude Code CLI has no top-level `login` subcommand — auth is under
      // the `auth` group (`claude auth login/logout/status`).
      loginCommand: 'claude auth login',
      docsUrl: 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code',
    },
    codex: {
      installCommand: 'npm i -g @openai/codex',
      loginCommand: 'codex login',
      docsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
    },
    opencode: {
      installCommand: 'curl -fsSL https://opencode.ai/install | bash',
      loginCommand: 'opencode auth login',
      docsUrl: 'https://opencode.ai/docs#install',
    },
    droid: {
      installCommand: 'curl -fsSL https://app.factory.ai/cli | sh',
      // The droid CLI has no dedicated login subcommand — running `droid`
      // starts an interactive session that prompts for login when needed.
      loginCommand: 'droid',
      docsUrl: 'https://docs.factory.ai/cli/getting-started/overview',
    },
    grok: {
      installCommand: 'npm i -g @xai-official/grok',
      loginCommand: 'grok login',
      docsUrl: 'https://docs.x.ai/build/overview',
    },
    cortex: {
      installCommand: 'curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh',
      loginCommand: 'cortex login',
      docsUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli',
    },
  };

  /** Randomized provider order computed once per component mount */
  const randomizedProviderOrder = shuffleArray(Object.values(ACP_PROVIDERS));

  /** Visible providers (not hidden by env var / feature code gates),
   *  tier-ordered (confirmed-logged-in → installed-not-logged-in-or-unknown →
   *  not-installed) from the last-known statuses, preserving the mount-time
   *  shuffle within each tier. Tier 1 requires `authenticated === true` — a
   *  stricter bar than `isProviderReady`, which counts unknown auth as ready. */
  const visibleProviders = $derived.by(() => {
    const state = appStore.state;
    // Reactive reads from Redux selectors
    const statusMap = $providerStatusMap$;
    const loadingMap = $providerLoadingMap$;
    const hasCheckedOnce = $hasCheckedOnce$;
    return orderOnboardingProviders(randomizedProviderOrder, statusMap)
      .filter((p) =>
        // Feature-code gate + env-var gate (via availability status, default-deny)
        isOnboardingProviderVisible({
          provider: p,
          isFeatureEnabled: (code) => selectIsFeatureEnabled.select(state, code),
          status: statusMap[p.id],
        }),
      )
      .map((p) => {
        const meta = PROVIDER_METADATA[p.id];
        const status = statusMap[p.id];
        return {
          id: p.id,
          name: p.displayName,
          available: status?.available ?? false,
          /** Whether the user is authenticated. undefined = not checked yet. */
          authenticated: status?.authenticated,
          /** Whether the availability check is still in-flight for this provider.
           *  Once we have a cached status for the provider, don't flip back to
           *  "loading" on background refreshes — avoids visual jitter where the
           *  card briefly shows "Checking…" every poll cycle. */
          statusLoading: (loadingMap[p.id] && !status) ?? !hasCheckedOnce,
          /**
           * User identity extracted from the provider's CLI (email / username).
           * Only set when the provider is authenticated AND we could parse
           * something useful out of the CLI stdout — may be undefined.
           */
          authDetails: status?.authDetails,
          docsUrl: meta?.docsUrl ?? p.loginDocsUrl ?? '',
          installCommand: meta?.installCommand ?? '',
          loginCommand: meta?.loginCommand ?? '',
          description: PROVIDER_DESCRIPTIONS[p.id] ?? '',
          hasNpxFallback: status?.hasNpxFallback ?? false,
          /** Status warning surfaced by the availability check (e.g. npx missing). */
          warning: status?.warning,
        };
      });
  });

  /** A provider is ready when installed, not explicitly unauthenticated
   *  (unknown auth verdicts count as ready, matching settings'
   *  `isProviderReadyForUse` for non-Auggie providers), and (for Auggie) on
   *  a supported version. Matches ProviderCard's own `ready` derivation and
   *  is the gate for both "clickable to select" and "counts as available". */
  function isProviderReady(p: (typeof visibleProviders)[number]): boolean {
    if (!p.available || p.statusLoading) return false;
    if (p.id === 'auggie' && auggieNeedsUpdate) return false;
    return p.authenticated !== false;
  }

  const readyProviderIds = $derived(visibleProviders.filter(isProviderReady).map((p) => p.id));

  const hasAnyProvider = $derived(readyProviderIds.length > 0);

  /** Which card should render as "selected" — mirrors the provider
   *  resolveOnboardingModel would pick for the common no-override case
   *  (active provider if ready, else Auggie, else first ready). */
  const selectedProviderId = $derived(
    resolveOnboardingSelectedProvider({
      activeProviderId: $activeProviderId$,
      defaultProviderId: getDefaultProviderId(),
      readyProviderIds,
    }),
  );

  $effect(() => {
    onAvailabilityChange?.(hasAnyProvider);
  });

  async function handleSelectProvider(providerId: string) {
    appStore.dispatch(setProviderEnabled({ providerId, enabled: true }));
    appStore.dispatch(setActiveProvider(providerId));
    appStore.dispatch(reloadModelsForProvider());
    onProviderSelected?.(providerId);
  }

  // Auggie version gate: AUGGIE_CHANNELS.STATUS drives the "Update needed"
  // badge. Users complete install/login in their own terminal (the card links
  // out to the docs); the focus/visibility listeners below re-run detection
  // when they return to the app.
  const logger = createLogger('AgentGrid');

  let auggieVersionOk = $state<boolean | undefined>(undefined);
  let auggieNeedsUpdate = $derived(auggieVersionOk === false);

  /** Fetch auggie version status from AUGGIE_CHANNELS.STATUS. */
  async function checkAuggieVersion() {
    try {
      const result = await invoke<{
        success: boolean;
        data?: { versionOk: boolean; version?: string; minimumVersion?: string };
      }>(AUGGIE_CHANNELS.STATUS);
      if (result.data) {
        auggieVersionOk = result.data.versionOk;
      }
    } catch (err) {
      logger.debug('Failed to check auggie version', { error: err });
    }
  }

  onMount(() => {
    appStore.dispatch(ensureProvidersCheckedAction());
    checkAuggieVersion();

    // Re-check all provider statuses on window focus/visibility
    // (user may have finished the manual install/login in their terminal)
    const handleFocus = () => {
      appStore.dispatch(checkAllProvidersRequested());
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        appStore.dispatch(checkAllProvidersRequested());
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  });
</script>

<div class="flex gap-4 w-full">
  {#each visibleProviders as provider, i (provider.id)}
    <div
      class="overflow-hidden transition-all flex flex-col flex-1 min-w-66"
      in:fly={{ y: 20, duration: 300, delay: i * 60 }}
      animate:flip={{ duration: 300 }}
    >
      <ProviderCard
        {provider}
        brand={PROVIDER_BRAND_COLORS[provider.id] ?? DEFAULT_BRAND}
        selected={provider.id === selectedProviderId}
        npxStatus={$npxStatus$}
        {auggieNeedsUpdate}
        onSelect={handleSelectProvider}
      />
    </div>
  {/each}
</div>
