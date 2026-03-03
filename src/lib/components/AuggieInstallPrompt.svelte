<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { invoke } from '$lib/electron-bridge';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import Fa from 'svelte-fa';
  import {
    faExternalLinkAlt,
    faDownload,
    faCheckCircle,
    faExclamationTriangle,
  } from '@fortawesome/free-solid-svg-icons';

  const logger = createLogger('AuggieInstallPrompt');

  let isChecking = $state(true);
  let isAvailable = $state(false);
  let isInstalling = $state(false);
  let showPrompt = $state(false);

  // Don't show on sandbox/test pages
  const isSandboxPage = $derived(
    $page.url.pathname.startsWith('/sandbox') || $page.url.pathname.startsWith('/test'),
  );

  onMount(async () => {
    await checkAuggieAvailability();
  });

  async function checkAuggieAvailability() {
    try {
      isChecking = true;
      logger.debug('Checking Auggie availability...');

      // Check if auggie is available
      const result = await invoke<{ success: boolean; available?: boolean }>(
        'auggie:check-availability',
      );

      if (result.success && result.available) {
        isAvailable = true;
        showPrompt = false;
        logger.info('Auggie is available');
      } else {
        isAvailable = false;
        showPrompt = true;
        logger.warn('Auggie is not available');
      }
    } catch (error) {
      logger.error('Failed to check Auggie availability', { error });
      isAvailable = false;
      showPrompt = true;
    } finally {
      isChecking = false;
    }
  }

  async function installAuggie() {
    try {
      isInstalling = true;
      logger.info('Installing Auggie...');

      const result = await invoke<{ success: boolean; error?: string }>('auggie:install');

      if (result.success) {
        toast.success('Agent provider installed successfully!', {
          description: 'You can now create and use agents in your workspaces.',
        });
        isAvailable = true;
        showPrompt = false;

        // Refresh models now that auggie is installed
        logger.info('Auggie installed, refreshing model list...');
        void modelStore.retryLoadModels();

        // Re-check availability to confirm
        await checkAuggieAvailability();
      } else {
        throw new Error(result.error || 'Installation failed');
      }
    } catch (error) {
      logger.error('Failed to install Auggie', { error });
      toast.error('Installation failed', {
        description: (error as Error).message || 'Please try installing manually using npm.',
      });
    } finally {
      isInstalling = false;
    }
  }

  function openDocs() {
    handleLink('https://docs.augmentcode.com/cli/overview', {
      workspaceId: workspaceStore.current?.id,
    });
  }
</script>

{#if showPrompt && !isChecking && !isSandboxPage}
  <div class="fixed bottom-4 left-4 z-50 max-w-md animate-in slide-in-from-bottom-2">
    <div class="bg-card border border-border rounded-lg shadow-lg p-4">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          <Fa icon={faExclamationTriangle} class="text-yellow-500" size="lg" />
        </div>

        <div class="flex-1 space-y-3">
          <div>
            <h3 class="font-semibold text-foreground">No Agent Provider Found</h3>
            <p class="text-sm text-subtle mt-1">
              An agent provider is required to create and interact with agents. Install Auggie or
              another compatible CLI.
            </p>
          </div>

          <div class="space-y-2">
            <div class="text-sm text-subtle">
              <p class="font-medium mb-1">Install using npm:</p>
              <code class="bg-muted px-2 py-1 rounded text-xs"
                >npm install -g @augmentcode/auggie</code
              >
            </div>
          </div>

          <div class="flex gap-2">
            <Button size="sm" onclick={installAuggie} disabled={isInstalling} class="gap-2">
              {#if isInstalling}
                <span class="animate-spin">⏳</span>
                Installing...
              {:else}
                <Fa icon={faDownload} size="sm" />
                Install Automatically
              {/if}
            </Button>

            <Button size="sm" variant="outline" onclick={openDocs} class="gap-2">
              <Fa icon={faExternalLinkAlt} size="sm" />
              View Docs
            </Button>

            <Button size="sm" variant="ghost" onclick={() => (showPrompt = false)}>Dismiss</Button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if isAvailable && !showPrompt && !isChecking}
  <!-- Optional: Show a success indicator briefly -->
  <div class="hidden">
    <!-- Auggie is available, no action needed -->
  </div>
{/if}
