<script lang="ts">
  /**
   * ProviderCard
   *
   * A single provider card for the AgentGrid. Renders brand-color top area,
   * provider icon, connection status, install/login controls, and auggie-specific
   * auth UI. Extracted from AgentGrid to keep per-provider rendering isolated.
   */
  import { slide } from 'svelte/transition';
  import {
  faArrowUpRightFromSquare,
  faArrowsRotate,
  faPlug,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import ProviderIcon from '$lib/components/ui/ProviderIcon.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { shell } from '$lib/electron-bridge';
  import { CLAUDE_CODE_NPX_MISSING_WARNING } from '$shared/constants/claude-code';
  import AuggieInstructionsPanel from '$lib/components/AuggieInstructionsPanel.svelte';

  import { selectProviderLoadingMap } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import { checkSingleProviderRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { store as appStore } from '$store/renderer/store';

  const providerLoadingMap$ = selectProviderLoadingMap();

  export interface ProviderCardData {
    id: string;
    name: string;
    available: boolean;
    authenticated: boolean | undefined;
    statusLoading: boolean;
    authDetails: string | undefined;
    docsUrl: string;
    installCommand: string;
    loginCommand: string;
    description: string;
    hasNpxFallback: boolean;
    /** Status warning from the availability check (e.g. npx missing for claude-code). */
    warning?: string;
  }

  export interface ProviderBrandColors {
    color1: string;
    color2: string;
    isLight?: boolean;
  }

  import type { NpxStatus } from '$shared/types/provider-availability';

  interface Props {
    provider: ProviderCardData;
    brand: ProviderBrandColors;
    /** Whether this card is the currently selected onboarding provider.
     *  Only meaningful when the card is ready (installed + authenticated).
     *  Renders a full-card-width "SELECTED" banner across the top of the card. */
    selected?: boolean;
    /** npx availability status for npx-fallback hint */
    npxStatus: NpxStatus | null | undefined;
    /** Whether auggie needs a version update */
    auggieNeedsUpdate: boolean;
    /** Whether an auggie action (install/login) is in progress */
    auggieActionInProgress: boolean;
    /**
     * Manual instructions returned by AUGGIE_CHANNELS.INSTALL /
     * AUGGIE_CHANNELS.AUTHENTICATE — when set, the card renders an
     * inline instructions panel with the copyable `command`.
     */
    auggieInstructions: string[] | null;
    /** Copyable shell command paired with `auggieInstructions`. */
    auggieCommand: string | null;
    /** Called when a ready provider is selected */
    onSelect: (providerId: string) => void;
    /** Called to install auggie */
    onAuggieInstall: () => void;
    /** Called to start auggie login */
    onAuggieLogin: () => void;
    /** Called when the user finishes the manual step and asks for a recheck. */
    onAuggieRecheck: () => void;
    /** Called when the user dismisses the instructions panel. */
    onAuggieDismissInstructions: () => void;
  }

  let {
    provider,
    brand,
    selected = false,
    npxStatus,
    auggieNeedsUpdate,
    auggieActionInProgress,
    auggieInstructions,
    auggieCommand,
    onSelect,
    onAuggieInstall,
    onAuggieLogin,
    onAuggieRecheck,
    onAuggieDismissInstructions,
  }: Props = $props();

  const installed = $derived(provider.available);
  const needsInstall = $derived(!provider.available && !provider.statusLoading);
  const needsUpdate = $derived(provider.id === 'auggie' && installed && auggieNeedsUpdate);
  const needsLogin = $derived(
    provider.available &&
      !provider.statusLoading &&
      !needsUpdate &&
      provider.authenticated !== true,
  );
  const ready = $derived(installed && !needsLogin && !needsUpdate);
  const needsAction = $derived(
    !provider.statusLoading && (needsInstall || needsLogin || needsUpdate),
  );
  const cardClickable = $derived(
    (provider.id === 'auggie' && needsAction) ||
      (!ready && !provider.statusLoading && provider.id !== 'auggie' && !!provider.docsUrl),
  );

  // Show npx hint when: provider has npx fallback, binary not installed, npx missing or too old
  const showNpxMissingHint = $derived(
    provider.hasNpxFallback && needsInstall && npxStatus?.resolvedPath === null,
  );
  const showNpxOldHint = $derived(
    provider.hasNpxFallback &&
      needsInstall &&
      npxStatus?.resolvedPath !== null &&
      npxStatus?.versionOk === false,
  );

  function openDocs(url: string, e: Event) {
    e.stopPropagation();
    shell.open(url);
  }

  function handleCardClick() {
    if (ready) {
      onSelect(provider.id);
    } else if (needsAction && provider.id === 'auggie') {
      if (needsInstall || needsUpdate) onAuggieInstall();
      else onAuggieLogin();
    } else if (!ready && !provider.statusLoading && provider.id !== 'auggie' && provider.docsUrl) {
      shell.open(provider.docsUrl);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  }

</script>

<div class="overflow-hidden transition-all flex flex-col flex-1 min-w-66">
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class={cn(
      'group/card relative w-full aspect-[3/4] flex flex-col justify-between p-7 text-left rounded-xl overflow-hidden transition-colors duration-500 border',
      cardClickable ? 'cursor-pointer border-transparent' : 'cursor-default border-border',
      !ready && needsAction && 'border-border',
      installed && brand.isLight && 'text-slate-800',
      installed && !brand.isLight && 'text-white',
    )}
    role={cardClickable ? 'button' : undefined}
    tabindex={cardClickable ? 0 : undefined}
    aria-pressed={ready ? selected : undefined}
    onclick={handleCardClick}
    onkeydown={handleKeydown}
    aria-label={provider.statusLoading
      ? `${provider.name} (checking\u2026)`
      : needsUpdate
        ? `${provider.name} (update needed)`
        : provider.available && !needsLogin
          ? selected
            ? `${provider.name} (selected)`
            : `Use ${provider.name}`
          : needsLogin
            ? `${provider.name} (not logged in)`
            : `${provider.name} (not installed)`}
  >
    <!-- Gradient overlay — always present, opacity animates on install -->
    <div
      class={cn(
        'absolute inset-0 rounded-lg transition-all transform duration-700 ease-out',
        !installed && 'opacity-0 translate-y-full',
        (needsLogin || needsUpdate) && 'translate-y-[calc(100%_-_13rem)]',
        installed && 'opacity-100',
      )}
      style="background: linear-gradient(in oklab to bottom, {brand.color1} 10%, {brand.color2} 88%);"
    ></div>

    <!-- Icon in top-left -->
    <span
      class={cn(
        'relative z-10 transition-all transform origin-center duration-300',
        provider.statusLoading && 'animate-pulse',
      )}
    >
      <ProviderIcon
        providerId={provider.id}
        class={cn(installed && (needsLogin || needsUpdate) && 'text-foreground')}
        size={32}
      />
    </span>

    <!-- Full-card-width "SELECTED" banner across the top edge; the card's
         overflow-hidden + rounded-xl clip its outer corners to match. Sits
         above the gradient/brand overlay via z-20. -->
    {#if ready && selected}
      <div
        data-testid="provider-card-selected-banner"
        class="absolute top-0 inset-x-0 z-20 flex items-center justify-center bg-primary text-primary-foreground py-1 text-xs font-semibold uppercase tracking-widest"
      >
        Selected
      </div>
    {/if}

    <!-- Bottom area: name + status row -->
    <div class="relative z-10 flex flex-col">
      <div class="flex items-center gap-1.5 min-w-0 pb-1.5">
        {#if provider.docsUrl}
          <button
            onclick={(e) => openDocs(provider.docsUrl, e)}
            class="font-medium text-lg truncate min-w-0 cursor-pointer"
          >
            {provider.name}
          </button>
        {:else}
          <div class="font-medium text-lg truncate min-w-0">
            {provider.name}
          </div>
        {/if}
        {#if provider.docsUrl}
          <button
            type="button"
            class="group/button shrink-0 opacity-50 flex items-center gap-1.5 hover:opacity-100 transition-colors p-0.5 cursor-pointer"
            onclick={(e) => openDocs(provider.docsUrl, e)}
            title="Open {provider.name} docs"
            aria-label="Open {provider.name} docs"
          >
            <!-- <span class="text-xs w-0 overflow-hidden group-hover/button:w-8 transition-all"
              >Docs</span
            > -->
            <Fa icon={faArrowUpRightFromSquare} size={11} />
          </button>
        {/if}
      </div>

      {#if provider.description}
        <p class="text-xs opacity-70 leading-snug pb-4">
          {provider.description}
        </p>
      {/if}

      <div class="text-xs flex items-center gap-1.5">
        {#if provider.statusLoading}
          <span class="opacity-50">Checking…</span>
        {:else if needsUpdate}
          <span class="opacity-70">Update needed</span>
        {:else if provider.available && !needsLogin}
          <div class="flex items-center whitespace-nowrap min-w-0">
            <div class="flex items-center -ml-3.5" transition:slide={{ axis: 'x', duration: 200 }}>
              <div class="h-px bg-gradient-to-r from-transparent to-current w-3 mt-px"></div>
              <Fa icon={faPlug} class="mr-1.5 transform rotate-90" size={12} />
            </div>
            <div class="flex items-center whitespace-nowrap truncate font-medium">
              Connected
              {#if provider.authDetails}
                <Tooltip side="top" content={provider.authDetails} disableHoverableContent>
                  <div
                    class="text-xs opacity-70 font-normal truncate pl-1"
                    transition:slide={{ axis: 'y', duration: 200 }}
                  >
                    as {provider.authDetails}
                  </div>
                </Tooltip>
              {/if}
            </div>
          </div>
        {:else if needsLogin}
          <span
            class="border border-border rounded-sm bg-background text-foreground px-2.25 py-0.75 font-medium"
            >Log in</span
          >
        {:else}
          <span
            class="border border-border rounded-sm bg-background text-foreground px-2.25 py-0.75 font-medium"
            >Not installed</span
          >
        {/if}

        <div class="flex items-center gap-1.5">
          {#if needsInstall || needsLogin || needsUpdate}
            <button
              type="button"
              class="flex-none opacity-50 hover:opacity-100 transition-colors px-0.5 py-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={(e) => {
                e.stopPropagation();
                appStore.dispatch(checkSingleProviderRequested(provider.id));
              }}
              disabled={$providerLoadingMap$[provider.id] ||
                (provider.id === 'auggie' && auggieActionInProgress)}
              title="Refresh {provider.name} status"
              aria-label="Refresh {provider.name} status"
            >
              <span
                class={cn('inline-block', {
                  'animate-spin':
                    $providerLoadingMap$[provider.id] ||
                    (provider.id === 'auggie' && auggieActionInProgress),
                })}
              >
                <Fa icon={faArrowsRotate} size={14} />
              </span>
            </button>
          {/if}
        </div>
      </div>

      <!-- npx requirement hint for shim providers when binary not installed + npx missing/old -->
      {#if showNpxMissingHint}
        <div class="mt-2 flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-500">
          <Fa icon={faTriangleExclamation} class="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            Requires Node.js (npx) — <button
              type="button"
              class="underline hover:no-underline"
              onclick={() => shell.open('https://nodejs.org')}
            >install from nodejs.org</button>
          </span>
        </div>
      {:else if showNpxOldHint}
        <div class="mt-2 flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-500">
          <Fa icon={faTriangleExclamation} class="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>npm/npx too old — npm 7+ required</span>
        </div>
      {/if}

      <!-- Provider status warning (e.g. claude-code installed but npx missing) -->
      {#if provider.warning && !provider.statusLoading}
        <div class="mt-2 flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-500">
          <Fa icon={faTriangleExclamation} class="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            {provider.warning}{#if provider.warning === CLAUDE_CODE_NPX_MISSING_WARNING}
              — <button
                type="button"
                class="underline hover:no-underline"
                onclick={() => void shell.open('https://nodejs.org')}
              >nodejs.org</button>
            {/if}
          </span>
        </div>
      {/if}

      <!-- Auggie instructions panel (rendered from IPC data.instructions/data.command) -->
      {#if provider.id === 'auggie' && auggieInstructions && auggieInstructions.length > 0}
        <div class="mt-2">
          <AuggieInstructionsPanel
            instructions={auggieInstructions}
            command={auggieCommand ?? undefined}
            onRecheck={onAuggieRecheck}
            onDismiss={onAuggieDismissInstructions}
            rechecking={auggieActionInProgress}
          />
        </div>
      {/if}
    </div>
  </div>
</div>
