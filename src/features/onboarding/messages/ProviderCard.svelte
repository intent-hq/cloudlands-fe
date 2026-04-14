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
    faArrowRightToBracket,
    faArrowUpRightFromSquare,
    faArrowsRotate,
    faDownload,
    faPlug,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils';
  import ProviderIcon from '$lib/components/ui/ProviderIcon.svelte';
  import TooltipRich from '$lib/components/ui/tooltip/TooltipRich.svelte';
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
    /** Called to run a command in a terminal */
    onRunCommand: (cmd: string, providerName: string, e: Event) => void;
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
    onRunCommand,
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
  const cmd = $derived(
    needsInstall ? provider.installCommand : needsLogin ? provider.loginCommand : '',
  );
  const ready = $derived(installed && !needsLogin && !needsUpdate);
  const needsAction = $derived(
    !provider.statusLoading && (needsInstall || needsLogin || needsUpdate),
  );
  const cardClickable = $derived(needsAction);

  /** Label for the auggie action button (install / update / login). */
  const auggieActionLabel = $derived(
    needsInstall ? 'Install Auggie' : needsUpdate ? 'Update Auggie' : 'Log in to Auggie',
  );

  function openDocs(url: string, e: Event) {
    e.stopPropagation();
    shell.open(url);
  }

  function handleCardClick(e: Event) {
    if (ready) {
      onSelect(provider.id);
    } else if (needsAction) {
      if (provider.id === 'auggie') {
        if (needsInstall || needsUpdate) onAuggieInstall();
        else onAuggieLogin();
      } else if (cmd) {
        onRunCommand(cmd, provider.name, e);
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick(e);
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
      <div class="flex items-center gap-1.5 min-w-0">
        <div class="font-medium text-lg truncate flex-1 min-w-0">
          {provider.name}
        </div>
        {#if provider.docsUrl}
          <button
            type="button"
            class="group/button shrink-0 opacity-50 flex items-center gap-1.5 hover:opacity-100 transition-colors p-0.5 cursor-pointer"
            onclick={(e) => openDocs(provider.docsUrl, e)}
            title="Open {provider.name} docs"
            aria-label="Open {provider.name} docs"
          >
            <span class="text-xs w-0 overflow-hidden group-hover/button:w-8 transition-all"
              >Docs</span
            >
            <Fa icon={faArrowUpRightFromSquare} size={11} />
          </button>
        {/if}
      </div>

      {#if provider.description}
        <p class="text-xs opacity-70 leading-snug pb-2">
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
            <div class="flex items-center whitespace-nowrap truncate opacity-70">
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
          <span class="opacity-70">Not logged in</span>
        {:else}
          <span class="opacity-70">Not installed</span>
        {/if}

        <div class="ml-auto flex items-center gap-1.5">
          {#if provider.id === 'auggie' && (needsInstall || needsLogin || needsUpdate)}
            <!-- Auggie uses a managed binary download + OAuth flow -->
            <Tooltip
              side="top"
              content={auggieActionLabel}
              disableHoverableContent
            >
              <button
                class="text-inherit opacity-50 hover:opacity-100 transition-colors cursor-pointer p-1.5 disabled:opacity-30 disabled:cursor-not-allowed h-6.5"
                onclick={(e) => {
                  e.stopPropagation();
                  if (needsInstall || needsUpdate) onAuggieInstall();
                  else onAuggieLogin();
                }}
                disabled={auggieActionInProgress}
                title={auggieActionLabel}
                aria-label={auggieActionLabel}
              >
                {#if auggieActionInProgress}
                  <span class="inline-block animate-spin">
                    <Fa icon={faArrowsRotate} size={14} />
                  </span>
                {:else}
                  <Fa
                    icon={needsInstall || needsUpdate ? faDownload : faArrowRightToBracket}
                    size={16}
                  />
                {/if}
              </button>
            </Tooltip>
          {:else if cmd}
            <TooltipRich side="top" maxWidth="24rem">
              {#snippet content()}
                <p>{needsLogin ? 'Log in using' : 'Install using'}</p>
                <div class="font-medium text-xs">{cmd}</div>
                <p class="opacity-50">Click to paste in terminal</p>
              {/snippet}
              <button
                class="text-inherit opacity-50 hover:opacity-100 transition-colors cursor-pointer p-1.5"
                onclick={(e) => onRunCommand(cmd, provider.name, e)}
                title={needsLogin ? 'Run login command' : 'Run install command'}
                aria-label={needsLogin ? 'Run login command' : 'Run install command'}
              >
                <Fa icon={faTerminal} size={14} />
              </button>
            </TooltipRich>
          {/if}

          <button
            type="button"
            class="flex-none opacity-50 hover:opacity-100 transition-colors px-0.5 py-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={(e) => {
              e.stopPropagation();
              dispatch(checkSingleProviderRequested(provider.id));
            }}
            disabled={$providerLoadingMap$[provider.id]}
            title="Refresh {provider.name} status"
            aria-label="Refresh {provider.name} status"
          >
            <span class={cn('inline-block', { 'animate-spin': $providerLoadingMap$[provider.id] })}>
              <Fa icon={faArrowsRotate} size={14} />
            </span>
          </button>
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
