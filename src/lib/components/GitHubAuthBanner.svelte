<script lang="ts">
  import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
  import GitHubIcon from '$lib/components/icons/GitHubIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
  faCheck,
  faRotateRight,
  faSpinner,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import {
  onDestroy,
  onMount,
} from 'svelte';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
  initializeGitHubAuth,
  startGitHubAuth,
  cancelGitHubAuth,
  clearGitHubAuthError,
} from '$lib/store/slices/github-auth/github-auth-slice';
  import {
  selectGitHubAuthIsAuthenticated,
  selectGitHubAuthIsAuthenticating,
  selectGitHubAuthOauthUrl,
  selectGitHubAuthError,
  selectGitHubAuthRequiresAugmentAuth,
} from '$lib/store/slices/github-auth/github-auth-selectors';

  interface Props {
    /** Message shown before auth starts */
    message?: string;
    /** Called when auth succeeds */
    onSuccess?: () => void;
    /** Additional classes */
    class?: string;
    /** If true, automatically start auth flow on mount */
    autoStart?: boolean;
  }

  let {
    message = 'Connect to GitHub',
    onSuccess,
    class: className = '',
    autoStart = false,
  }: Props = $props();

  const dispatch = getDispatch();
  const isAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const isAuthenticating$ = selectGitHubAuthIsAuthenticating();
  const oauthUrl$ = selectGitHubAuthOauthUrl();
  const error$ = selectGitHubAuthError();
  const requiresAugmentAuth$ = selectGitHubAuthRequiresAugmentAuth();

  let authStartedHere = $state(false);
  let isCheckingAuth = $state(false);
  let showSuccess = $state(false);

  // Initialize auth state on mount and optionally auto-start
  onMount(() => {
    dispatch(initializeGitHubAuth());
    if (autoStart) {
      handleConnect();
    }
  });

  function handleConnect() {
    authStartedHere = true;
    dispatch(startGitHubAuth());
  }

  function handleCancel() {
    if (authStartedHere) {
      dispatch(cancelGitHubAuth());
      authStartedHere = false;
    }
  }

  function handleRetry() {
    dispatch(clearGitHubAuthError());
    handleConnect();
  }

  function handleAuthSuccess() {
    authStartedHere = false;
    showSuccess = true;
    // Show success state for 1 second before calling onSuccess
    setTimeout(() => {
      showSuccess = false;
      if (typeof onSuccess === 'function') {
        onSuccess();
      }
    }, 1000);
  }

  // Manually check auth status (for "Try now" button and focus handler)
  async function checkAuthStatus() {
    // Check authStartedHere directly, not derived values
    if (!authStartedHere) return;
    if ($isAuthenticated$) {
      handleAuthSuccess();
      return;
    }

    isCheckingAuth = true;
    try {
      // Check directly with the client to bypass any potential store state issues
      const isAuth = await githubAuthClient.isAuthenticated();

      if (isAuth) {
        // Update the store state
        dispatch(initializeGitHubAuth());
        handleAuthSuccess();
      }
    } catch {
      // Failed to refresh auth state - user can retry manually
    } finally {
      isCheckingAuth = false;
    }
  }

  // Watch for auth state changes from the store (when polling succeeds)
  $effect(() => {
    if (authStartedHere && $isAuthenticated$) {
      handleAuthSuccess();
    }
  });

  // Check auth status on window focus when waiting for authorization
  $effect(() => {
    // Only set up listener when we have an OAuth URL displayed (waiting for auth)
    if (!authStartedHere || !$oauthUrl$) return;

    const handleFocus = () => {
      checkAuthStatus();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  });

  // Poll auth status every 1 second when waiting for authorization
  $effect(() => {
    if (!authStartedHere || !$oauthUrl$) return;

    const interval = setInterval(() => {
      checkAuthStatus();
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  });

  onDestroy(() => {
    if (authStartedHere && $isAuthenticating$) {
      dispatch(cancelGitHubAuth());
    }
  });

  // Derived state for cleaner template
  const isAuthenticating = $derived(authStartedHere && $isAuthenticating$);
  const hasOAuthUrl = $derived(authStartedHere && $oauthUrl$);
  const hasError = $derived(authStartedHere && $error$);
</script>

<div class="rounded-sm bg-sidebar overflow-hidden {className}">
  {#if showSuccess}
    <!-- Success state - shows briefly after auth completes -->
    <div
      class="py-2 px-2 flex items-center gap-2 text-xs text-emerald-500"
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      <Fa icon={faCheck} size="xs" />
      <span>Connected to GitHub</span>
    </div>
  {:else if hasError}
    <!-- Error state -->
    <div class="py-2 px-2 space-y-2" transition:slide={{ axis: 'y', duration: 200 }}>
      <p class="text-xs text-destructive-foreground">{$error$}</p>
      <Button variant="outline" size="xs" onclick={handleRetry}>
        <Fa icon={faRotateRight} size="xs" />
        <span>Try Again</span>
      </Button>
    </div>
  {:else if $requiresAugmentAuth$}
    <!-- Augment auth required state -->
    <div class="py-2 px-2 space-y-1" transition:slide={{ axis: 'y', duration: 200 }}>
      <p class="text-xs text-subtle">Please authenticate with Augment first.</p>
      <p class="text-xs text-subtle">
        Run <code class="bg-muted px-1 rounded">auggie login</code> in your terminal.
      </p>
    </div>
  {:else if hasOAuthUrl}
    <!-- OAuth redirect state -->
    <div class="py-1.5 px-3 space-y-1" transition:slide={{ axis: 'y', duration: 200 }}>
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-subtle">Complete authorization in your browser</p>
        <Button variant="ghost-light" size="icon-xs -mt-2 -mr-2" onclick={handleCancel}>
          <Fa icon={faXmark} size="xs" />
        </Button>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-subtle">
        {#if isCheckingAuth}
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span>Checking...</span>
        {:else}
          <Fa icon={faSpinner} size="xs" class="animate-spin" />
          <span>Waiting for authorization...</span>
          <button
            type="button"
            class="cursor-pointer underline underline-offset-2 decoration-muted-foreground/20"
            onclick={checkAuthStatus}
          >
            Check now
          </button>
        {/if}
      </div>
    </div>
  {:else if isAuthenticating}
    <!-- Starting auth state -->
    <div
      class="py-2 px-2 flex items-center gap-2 text-xs text-subtle"
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      <Fa icon={faSpinner} size="xs" class="animate-spin" />
      <span>Starting authentication...</span>
    </div>
  {:else}
    <!-- Initial prompt state -->
    <button
      type="button"
      class="w-full py-2 px-2 flex items-center gap-2 hover:bg-muted/50 transition-colors cursor-pointer text-left"
      onclick={handleConnect}
      transition:slide={{ axis: 'y', duration: 200 }}
    >
      <div class="flex items-center justify-center">
        <GitHubIcon size={16} class="text-ghost" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-subtle">{message}</p>
        <p class="text-xs text-subtle">Enables PRs, repo listing, and more</p>
      </div>
    </button>
  {/if}
</div>
