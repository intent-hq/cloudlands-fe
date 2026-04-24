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
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import ProviderIcon from '$lib/components/ui/ProviderIcon.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { shell } from '$lib/electron-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectProviderLoadingMap } from '$lib/store/slices/agent-availability/agent-availability-selectors';
  import { checkSingleProviderRequested } from '$lib/store/slices/agent-availability/agent-availability-slice';

  const dispatch = getDispatch();
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
  }

  export interface ProviderBrandColors {
    color1: string;
    color2: string;
    isLight?: boolean;
  }

  interface Props {
    provider: ProviderCardData;
    brand: ProviderBrandColors;
    /** Whether auggie needs a version update */
    auggieNeedsUpdate: boolean;
    /** Whether an auggie action (install/login) is in progress */
    auggieActionInProgress: boolean;
    /** Whether auggie is waiting for browser auth */
    auggieWaitingForBrowser: boolean;
    /** Whether to show the manual auth paste UI */
    auggieShowManualAuth: boolean;
    /** Current manual auth input value */
    auggieManualAuthInput: string;
    /** Auth URL for manual open fallback */
    auggieAuthUrl: string | null;
    /** Auth error message */
    auggieAuthError: string | null;
    /** Called when a ready provider is selected */
    onSelect: (providerId: string) => void;
    /** Called to install auggie binary */
    onAuggieInstall: () => void;
    /** Called to start auggie login */
    onAuggieLogin: () => void;
    /** Called to complete manual auggie auth */
    onAuggieManualAuth: () => void;
    /** Called when manual auth input changes */
    onAuggieManualAuthInputChange: (value: string) => void;
  }

  let {
    provider,
    brand,
    auggieNeedsUpdate,
    auggieActionInProgress,
    auggieWaitingForBrowser,
    auggieShowManualAuth,
    auggieManualAuthInput,
    auggieAuthUrl,
    auggieAuthError,
    onSelect,
    onAuggieInstall,
    onAuggieLogin,
    onAuggieManualAuth,
    onAuggieManualAuthInputChange,
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
    onclick={handleCardClick}
    onkeydown={handleKeydown}
    aria-label={provider.statusLoading
      ? `${provider.name} (checking\u2026)`
      : needsUpdate
        ? `${provider.name} (update needed)`
        : provider.available && !needsLogin
          ? `Use ${provider.name}`
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
                dispatch(checkSingleProviderRequested(provider.id));
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
      <!-- Auggie inline auth UI (slides in) -->
      {#if provider.id === 'auggie' && (auggieWaitingForBrowser || auggieShowManualAuth || auggieAuthError)}
        <div class="space-y-1.5" transition:slide={{ duration: 200 }}>
          {#if auggieWaitingForBrowser}
            <p class="text-xs opacity-50">
              Waiting for browser…
              {#if auggieAuthUrl}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="underline cursor-pointer hover:opacity-100"
                  onclick={() => auggieAuthUrl && shell.open(auggieAuthUrl)}
                  role="link"
                  tabindex={0}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') auggieAuthUrl && shell.open(auggieAuthUrl);
                  }}
                >
                  Open manually
                </span>
              {/if}
            </p>
          {/if}

          {#if auggieShowManualAuth}
            <div class="flex items-center gap-1.5" transition:slide={{ duration: 200 }}>
              <input
                type="text"
                class="flex-1 min-w-0 py-1 text-xs focus:outline-none empty:opacity-40 placeholder-current"
                placeholder="Paste auth code…"
                value={auggieManualAuthInput}
                oninput={(e) => onAuggieManualAuthInputChange(e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && auggieManualAuthInput.trim()) onAuggieManualAuth();
                }}
              />
              <button
                class="shrink-0 text-xs opacity-70 hover:opacity-100 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={auggieActionInProgress || !auggieManualAuthInput.trim()}
                onclick={() => onAuggieManualAuth()}
              >
                {auggieActionInProgress ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          {/if}

          {#if auggieAuthError}
            <p class="text-xs text-destructive truncate" title={auggieAuthError}>
              {auggieAuthError}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
