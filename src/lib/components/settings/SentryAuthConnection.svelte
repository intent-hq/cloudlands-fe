<script lang="ts">
  import { handleLink } from '$features/navigation/link-handler';
  import { sentryAuthStore } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  interface Props {
    /** Skip initialization if parent already initialized the store */
    skipInitialize?: boolean;
  }

  let { skipInitialize = false }: Props = $props();

  let isDisconnectingSentry = $state(false);
  let showConnectForm = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');
  let isConnecting = $state(false);

  onMount(() => {
    if (!skipInitialize) {
      sentryAuthStore.initialize();
    }
  });

  async function handleSentryConnect() {
    if (!sentryOrg.trim() || !sentryToken.trim()) {
      return;
    }

    isConnecting = true;
    try {
      const success = await sentryAuthStore.connect(sentryOrg.trim(), sentryToken.trim());
      if (success) {
        // Clear form state first, then hide - this prevents flash
        sentryOrg = '';
        sentryToken = '';
        // Use a microtask to ensure state updates are processed
        await Promise.resolve();
        showConnectForm = false;
      }
    } finally {
      isConnecting = false;
    }
  }

  async function handleSentryDisconnect() {
    isDisconnectingSentry = true;
    try {
      await sentryAuthStore.logout();
    } finally {
      isDisconnectingSentry = false;
    }
  }

  function handleSentryReconnect() {
    showConnectForm = true;
    sentryOrg = sentryAuthStore.state.organization || '';
    sentryToken = '';
  }

  function handleCancelConnect() {
    showConnectForm = false;
    sentryOrg = '';
    sentryToken = '';
    sentryAuthStore.clearError();
  }
</script>

<div class="flex items-start justify-between gap-4">
  <div class="space-y-1">
    <div class="flex items-center gap-1">
      <SentryIcon size={17} class="text-muted-foreground" />
      <span class="text-sm text-foreground">Sentry</span>
      {#if sentryAuthStore.state.isAuthenticated}
        <span class="text-xs text-muted-foreground flex items-center gap-1">
          <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
          {#if sentryAuthStore.state.organization}
            {sentryAuthStore.state.organization}
          {:else}
            Connected
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-xs text-muted-foreground pl-6">Create spaces directly from issues.</p>
    {#if sentryAuthStore.state.error}
      <p class="text-xs text-destructive pl-6">{sentryAuthStore.state.error}</p>
    {/if}
  </div>

  <div class="flex items-center gap-2 text-xs">
    {#if sentryAuthStore.state.isConnecting || isConnecting}
      <span class="text-muted-foreground">Connecting...</span>
    {:else if sentryAuthStore.state.isAuthenticated}
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        onclick={handleSentryReconnect}
      >
        Reconnect
      </button>
      <span class="text-muted-foreground/30">·</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive cursor-pointer transition-colors"
        onclick={handleSentryDisconnect}
        disabled={isDisconnectingSentry}
      >
        {isDisconnectingSentry ? 'Disconnecting...' : 'Disconnect'}
      </button>
    {:else}
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
        onclick={() => (showConnectForm = true)}
      >
        Connect
      </button>
    {/if}
  </div>
</div>

{#if showConnectForm && !sentryAuthStore.state.isConnecting}
  <div class="space-y-3 rounded-md bg-sidebar p-3">
    <div class="space-y-2">
      <label for="sentry-org" class="block text-xs font-medium text-foreground">
        Organization Slug
      </label>
      <Input
        id="sentry-org"
        bind:value={sentryOrg}
        placeholder="your-org"
        disabled={isConnecting}
        class="text-sm"
      />
      <p class="text-[10px] text-muted-foreground">
        Your Sentry organization slug (found in your Sentry URL)
      </p>
    </div>

    <div class="space-y-2">
      <label for="sentry-token" class="block text-xs font-medium text-foreground">
        API Token
      </label>
      <Input
        id="sentry-token"
        type="password"
        bind:value={sentryToken}
        placeholder="sntrys_..."
        disabled={isConnecting}
        class="text-sm"
      />
      <p class="text-[10px] text-muted-foreground">
        Create a token at{' '}
        <button
          type="button"
          onclick={() => {
            const wsId = workspaceStore.current?.id;
            if (wsId) {
              handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
                workspaceId: WorkspaceId(wsId),
              });
            }
          }}
          class="text-primary hover:underline cursor-pointer"
        >
          sentry.io/settings/account/api/auth-tokens/
        </button>
        {' '}with scopes:
        <span class="font-mono text-foreground/70">org:read, project:read, event:read</span>
      </p>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="default"
        size="sm"
        onclick={handleSentryConnect}
        disabled={isConnecting || !sentryOrg.trim() || !sentryToken.trim()}
      >
        {isConnecting ? 'Connecting...' : 'Connect'}
      </Button>
      <Button variant="ghost" size="sm" onclick={handleCancelConnect} disabled={isConnecting}>
        Cancel
      </Button>
    </div>
  </div>
{/if}
