<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { invoke } from '$lib/electron-bridge';
  import { fetchPromotionalBanners } from '$lib/services/promotional-banner';
  import { selectActiveProviderId } from '$lib/store/slices/provider-settings/provider-settings-selectors';
  import { setActiveProvider } from '$lib/store/slices/provider-settings/provider-settings-slice';
  import { reloadModelsForProvider } from '$lib/store/slices/model/model-slice';
  import { selectAvailableModels } from '$lib/store/slices/model/model-selectors';
  import {
  dismissPromoBanner,
  recordPromoBannerInteraction,
  type PromoBannerInteraction,
} from '$lib/store/slices/user-preferences/user-preferences-slice';
  import { selectPromoBannerInteractions } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import type {
    PromotionalBanner as PromotionalBannerData,
    PromotionalBannerAction,
    PromotionalBannerButton,
  } from '$lib/types/promotional-banner';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { AUGGIE_CHANNELS } from '$shared/ipc/channels';
  import {
  faBell,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { fly } from 'svelte/transition';

  const dispatch = getDispatch();
  const activeProviderId$ = selectActiveProviderId();
  const availableModels$ = selectAvailableModels();
  const promoBannerInteractions$ = selectPromoBannerInteractions();

  const ACTION_SUCCESS_DURATION_MS = 2_000;
  const AUTO_DISMISS_DELAY_MS = 3_000;

  let banners = $state<PromotionalBannerData[]>([]);
  let dismissedBannerIds = $state<string[]>([]);
  let actionInFlight = $state(false);
  let actionSucceeded = $state(false);
  let actionFailed = $state(false);
  let actionErrorMessage = $state('');
  let currentStepIndex = $state(0);
  let allStepsComplete = $state(false);
  let auggieInstalled = $state(true); // assume installed until checked

  let flowStarted = $state(false);
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  const visibleBanner = $derived.by(() => {
    const now = Date.now();

    return (
      banners
        .filter((banner) => {
          if (dismissedBannerIds.includes(banner.id)) return false;

          const startAt = new Date(banner.startAt).getTime();
          const endAt = new Date(banner.endAt).getTime();
          if (
            !(
              Number.isFinite(startAt) &&
              Number.isFinite(endAt) &&
              now >= startAt &&
              now <= endAt
            )
          ) {
            return false;
          }

          return true;
        })
        .slice()
        .sort((left, right) => left.priority - right.priority)[0] ?? null
    );
  });

  /** Ordered list of applicable buttons — snapshot computed once at load time so the
   *  list doesn't shift as reactive conditions (e.g. active provider) change mid-flow. */
  let applicableButtons = $state<PromotionalBannerButton[]>([]);

  /** The current button to display (sequential flow — one at a time) */
  const currentButton = $derived.by(() => {
    if (allStepsComplete || currentStepIndex >= applicableButtons.length) {
      return null;
    }
    return applicableButtons[currentStepIndex] ?? null;
  });

  onMount(() => {
    void loadBanners();

    return () => {
      for (const timeoutId of pendingTimeouts) {
        clearTimeout(timeoutId);
      }
      pendingTimeouts.clear();
    };
  });

  // Recompute applicable buttons when provider changes, but
  // only if the user hasn't started the sequential flow yet (no action taken).
  $effect(() => {
    // Read reactive dependencies so Svelte tracks them

    // Only recompute if banners are loaded and the user hasn't started clicking buttons
    if (banners.length > 0 && !flowStarted && !allStepsComplete) {
      computeApplicableButtons();
    }
  });

  $effect(() => {
    const interactions = $promoBannerInteractions$;
    dismissedBannerIds = banners
      .filter((banner) => interactions[banner.id]?.dismissed === true)
      .map((banner) => banner.id);
  });

  async function loadBanners() {
    try {
      const fetchedBanners = await fetchPromotionalBanners();
      banners = fetchedBanners;
      dismissedBannerIds = fetchedBanners
        .filter((banner) => isBannerDismissed(banner.id))
        .map((banner) => banner.id);

      // Check if auggie is installed for display purposes
      try {
        const statusResult = await invoke<{
          success: boolean;
          data?: { installed: boolean };
        }>(AUGGIE_CHANNELS.STATUS);
        auggieInstalled = statusResult.success && statusResult.data?.installed === true;
      } catch {
        auggieInstalled = false;
      }

      // Compute applicable buttons based on initial state.
      computeApplicableButtons();
    } catch (error) {
      console.error('[PromotionalBanner] Failed to load promotional banners', error);
      banners = [];
      dismissedBannerIds = [];
    }
  }

  function computeApplicableButtons() {
    const now = Date.now();

    const filteredBanners = banners
      .filter((banner) => {
        if (dismissedBannerIds.includes(banner.id)) return false;

        const startAt = new Date(banner.startAt).getTime();
        const endAt = new Date(banner.endAt).getTime();
        if (
          !(
            Number.isFinite(startAt) &&
            Number.isFinite(endAt) &&
            now >= startAt &&
            now <= endAt
          )
        ) {
          return false;
        }

        return true;
      })
      .slice()
      .sort((left, right) => left.priority - right.priority);

    const banner = filteredBanners[0] ?? null;
    if (!banner) {
      applicableButtons = [];
      return;
    }

    const currentActiveProviderId = $activeProviderId$;
    const availableModelValues = new Set($availableModels$.map((model) => model.value));

    applicableButtons = banner.buttons.filter((button) => {
      if (button.hideWhen?.type === 'defaultAgentIs'
        && currentActiveProviderId === button.hideWhen.agentId) {
        // Only hide if the provider is actually usable (has models loaded).
        // If it's set as default but not installed (no models), keep the button
        // visible so the user can trigger the install flow.
        if (availableModelValues.size > 0) {
          return false;
        }
      }

      if (button.action.type === 'setDefaultModel') return false;

      return true;
    });
  }

  /** After switching providers mid-flow, recompute remaining buttons with the
   *  new provider's model list while preserving already-completed steps. */
  function recomputeRemainingButtons() {
    const banner = visibleBanner;
    if (!banner) return;

    const activeProviderId = $activeProviderId$;
    const availableModelValues = new Set($availableModels$.map((model) => model.value));

    // Keep buttons we've already completed (indices 0..currentStepIndex),
    // re-filter the rest from the original banner buttons
    const completedButtons = applicableButtons.slice(0, currentStepIndex + 1);

    const remainingOriginalButtons = banner.buttons.filter((button) => {
      // Skip buttons already in completed list
      if (completedButtons.includes(button)) return false;

      // Apply hideWhen filter
      if (button.hideWhen?.type === 'defaultAgentIs' && activeProviderId === button.hideWhen.agentId) {
        // Only hide if the provider is actually usable (has models loaded).
        // If it's set as default but not installed (no models), keep the button
        // visible so the user can trigger the install flow.
        if (availableModelValues.size > 0) {
          return false;
        }
      }

      if (button.action.type === 'setDefaultModel') return false;

      return true;
    });

    applicableButtons = [...completedButtons, ...remainingOriginalButtons];
  }

  function isBannerDismissed(id: string): boolean {
    return $promoBannerInteractions$[id]?.dismissed === true;
  }

  function recordInteraction(bannerId: string, interaction: PromoBannerInteraction) {
    dispatch(recordPromoBannerInteraction(bannerId, interaction));
  }

  function dismissBanner(id: string, completedAllSteps = false) {
    dispatch(dismissPromoBanner(id, new Date().toISOString(), completedAllSteps));
    dismissedBannerIds = [...new Set([...dismissedBannerIds, id])];
  }

  function scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      fn();
    }, ms);
    pendingTimeouts.add(id);
    return id;
  }

  function advanceToNextStep() {
    actionSucceeded = false;
    actionFailed = false;
    actionErrorMessage = '';

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= applicableButtons.length) {
      // All steps done — show final success then auto-dismiss
      allStepsComplete = true;
      if (visibleBanner) {
        scheduleTimeout(() => {
          if (visibleBanner) {
            dismissBanner(visibleBanner.id, true);
          }
        }, AUTO_DISMISS_DELAY_MS);
      }
    } else {
      currentStepIndex = nextIndex;
    }
  }

  async function handleButtonClick(action: PromotionalBannerAction): Promise<void> {
    actionInFlight = true;
    flowStarted = true;
    actionFailed = false;
    actionErrorMessage = '';

    try {
      if (action.type === 'setDefaultAgent') {
        // Check if Auggie is installed before trying to set it as default
        if (action.agentId === 'auggie') {
          // Use AUGGIE_CHANNELS.STATUS which actually runs `auggie --version` to
          // check installation — getProviderAvailability() is unreliable because
          // it returns available:true when ~/.augment/session.json exists even if
          // the auggie CLI is not installed.
          const statusResult = await invoke<{
            success: boolean;
            data?: { installed: boolean };
          }>(AUGGIE_CHANNELS.STATUS);
          const isInstalled = statusResult.success && statusResult.data?.installed;
          if (!isInstalled) {
            // Auggie not installed — navigate to settings so user can install it.
            // Reset flowStarted so the banner recomputes buttons when user returns.
            actionInFlight = false;
            flowStarted = false;
            if (visibleBanner) {
              recordInteraction(visibleBanner.id, {
                type: 'button_click',
                buttonText: currentButton?.text,
                actionType: action.type,
                result: 'navigated_to_settings',
                timestamp: new Date().toISOString(),
              });
            }
            await navigateToSettings({ tab: 'accounts' });
            return;
          }
        }

        dispatch(setActiveProvider(action.agentId));
        dispatch(reloadModelsForProvider());

        // Recompute remaining buttons now that models are loaded for the new provider.
        recomputeRemainingButtons();
      }

      if (visibleBanner) {
        recordInteraction(visibleBanner.id, {
          type: 'button_click',
          buttonText: currentButton?.text,
          actionType: action.type,
          result: 'success',
          timestamp: new Date().toISOString(),
        });
      }

      // Show success state, then advance after delay
      actionInFlight = false;
      actionSucceeded = true;
      scheduleTimeout(() => {
        advanceToNextStep();
      }, ACTION_SUCCESS_DURATION_MS);
    } catch (error) {
      console.error('[PromotionalBanner] Failed to run button action', error);
      actionInFlight = false;
      actionFailed = true;
      actionErrorMessage =
        action.type === 'setDefaultAgent' ? 'Failed to set provider' : 'Failed to set model';
      if (visibleBanner) {
        recordInteraction(visibleBanner.id, {
          type: 'button_click',
          buttonText: currentButton?.text,
          actionType: action.type,
          result: 'error',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  function retryCurrentStep() {
    if (currentButton) {
      void handleButtonClick(currentButton.action);
    }
  }
</script>

{#if visibleBanner}
  <div transition:fly={{ y: 30 }} class="relative z-20 shrink-0 bg-app-background">
    <div
      class="flex items-center gap-1.5 app-no-drag min-w-0 bg-primary/20 pt-0.75 pb-1.25 -mb-0.75 pl-3 pr-1 font-medium dark:text-primary text-[color-mix(in_hsl,_var(--color-primary)_50%,_var(--color-foreground)_50%)]"
    >
      <p class="text-xs truncate">
        <span class="bell-shake inline-flex"><Fa icon={faBell} size={14} class="mb-[-2px] mr-0.5 opacity-30" /></span>
        {visibleBanner.message}
      </p>

      {#if allStepsComplete}
        <span class="shrink-0 text-ui text-emerald-600 dark:text-emerald-400">✓ All set!</span>
      {:else if actionFailed}
        <span class="shrink-0 text-ui text-destructive-foreground">⚠ {actionErrorMessage}</span>
        <button
          class="shrink-0 text-ui underline"
          onclick={retryCurrentStep}
        >
          Retry
        </button>
      {:else if currentButton}
        <Button
          variant="outline"
          size="xs"
          class="shrink-0 py-1! h-auto! leading-none hover:bg-background"
          disabled={actionInFlight || actionSucceeded}
          onclick={() => handleButtonClick(currentButton.action)}
        >
          {#if actionInFlight}
            Applying…
          {:else if actionSucceeded}
            ✓ Done
          {:else}
            {currentButton.action.type === 'setDefaultAgent' && currentButton.action.agentId === 'auggie' && !auggieInstalled
              ? 'Open Settings to make Auggie the default'
              : currentButton.text}
          {/if}
        </Button>
      {/if}

      {#if visibleBanner.dismissable}
        <Button
          variant="ghost-light"
          size="icon-xs"
          class="shrink-0 -ml-1.5! hover:bg-transparent!"
          onclick={() => dismissBanner(visibleBanner.id)}
          aria-label="Dismiss promotion"
        >
          <Fa icon={faXmark} size="xs" />
        </Button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bell-shake {
    animation: bell-shake 500ms ease-in-out 500ms;
  }

  @keyframes bell-shake {
    0% { transform: rotate(0deg); }
    15% { transform: rotate(20deg); }
    30% { transform: rotate(-16deg); }
    50% { transform: rotate(12deg); }
    70% { transform: rotate(-8deg); }
    85% { transform: rotate(3deg); }
    100% { transform: rotate(0deg); }
  }
</style>
