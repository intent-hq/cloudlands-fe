<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faTimesCircle,
    faExclamationTriangle,
    faInfo,
    faChevronDown,
    faChevronRight,
    faLightbulb,
    faExternalLinkAlt,
  } from '@fortawesome/free-solid-svg-icons';
  import {
    isSvelteErrorUrl,
    resolveSvelteError,
    type SvelteErrorInfo,
  } from '$lib/utils/svelte-error-resolver';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';

  interface Props {
    error: string | Error | any;
    type?: 'error' | 'warning' | 'info';
    title?: string;
    collapsible?: boolean;
    defaultExpanded?: boolean;
  }

  let {
    error,
    type = 'error',
    title = '',
    collapsible = false,
    defaultExpanded = true,
  }: Props = $props();

  let isExpanded = $state(defaultExpanded);

  // Parse error object
  const errorMessage = $derived(
    typeof error === 'string' ? error : error?.message || error?.error || JSON.stringify(error),
  );

  const errorStack = $derived(error?.stack || null);

  // Check if this is a Svelte error and resolve it
  const svelteErrorInfo = $derived.by((): SvelteErrorInfo | null => {
    // First check if the error object already has svelteError info
    if (error?.svelteError) {
      return error.svelteError;
    }
    // Otherwise try to resolve from the message
    if (isSvelteErrorUrl(errorMessage)) {
      return resolveSvelteError(errorMessage);
    }
    return null;
  });

  // Display message - use Svelte description if available
  const displayMessage = $derived(svelteErrorInfo?.description ?? errorMessage);

  // Type configurations
  const typeConfig = {
    error: {
      icon: faTimesCircle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
      borderColor: 'border-destructive/30',
      defaultTitle: 'Error',
    },
    warning: {
      icon: faExclamationTriangle,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      defaultTitle: 'Warning',
    },
    info: {
      icon: faInfo,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      defaultTitle: 'Information',
    },
  };

  const config = $derived(typeConfig[type]);
  const displayTitle = $derived(title || config.defaultTitle);
</script>

<div class="my-3 rounded-lg border {config.borderColor} {config.bgColor} overflow-hidden">
  {#if collapsible}
    <button
      class="w-full px-4 py-3 flex items-start gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={config.icon} size="lg" class="{config.color} flex-shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0 text-left">
        <div class="text-sm font-semibold {config.color} mb-1">
          {displayTitle}
        </div>
        {#if !isExpanded}
          <div class="text-xs text-subtle truncate">
            {errorMessage}
          </div>
        {/if}
      </div>
      <Fa
        icon={isExpanded ? faChevronDown : faChevronRight}
        size="sm"
        class="text-subtle flex-shrink-0 mt-1"
      />
    </button>

    {#if isExpanded}
      <div class="px-4 pb-3 border-t {config.borderColor} pt-3">
        <div class="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          {displayMessage}
        </div>

        <!-- Svelte error debugging tips -->
        {#if svelteErrorInfo}
          <div class="mt-3 space-y-3">
            <!-- Debugging Tips -->
            <div class="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
              <div
                class="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 mb-2"
              >
                <Fa icon={faLightbulb} size="sm" />
                Debugging Tips
              </div>
              <ul class="text-xs text-foreground/80 space-y-1">
                {#each svelteErrorInfo.debuggingTips as tip, tipIndex (`tip-${tipIndex}-${tip.slice(0, 20)}`)}
                  <li class="flex items-start gap-2">
                    <span class="text-blue-500">•</span>
                    <span>{tip}</span>
                  </li>
                {/each}
              </ul>
            </div>

            <!-- Common Causes -->
            <div class="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
              <div class="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">
                Common Causes
              </div>
              <ul class="text-xs text-foreground/80 space-y-1">
                {#each svelteErrorInfo.commonCauses as cause, causeIndex (`cause-${causeIndex}-${cause.slice(0, 20)}`)}
                  <li class="flex items-start gap-2">
                    <span class="text-amber-500">•</span>
                    <span>{cause}</span>
                  </li>
                {/each}
              </ul>
            </div>

            <!-- Docs link -->
            <a
              href={svelteErrorInfo.docsUrl}
              class="inline-flex items-center gap-2 text-xs text-primary hover:underline"
              onclick={(e) => { e.preventDefault(); handleLink(svelteErrorInfo.docsUrl, { workspaceId: workspaceStore.current?.id, event: e }); }}
            >
              <Fa icon={faExternalLinkAlt} size="xs" />
              View Svelte Documentation
            </a>
          </div>
        {/if}

        {#if errorStack}
          <details class="mt-3">
            <summary class="text-xs font-semibold {config.color} cursor-pointer hover:underline">
              Stack Trace
            </summary>
            <pre
              class="mt-2 text-xs font-mono text-subtle bg-background/50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-64">{errorStack}</pre>
          </details>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="px-4 py-3 flex items-start gap-3">
      <Fa icon={config.icon} size="lg" class="{config.color} flex-shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold {config.color} mb-1">
          {displayTitle}
        </div>
        <div class="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          {errorMessage}
        </div>

        {#if errorStack}
          <details class="mt-3">
            <summary class="text-xs font-semibold {config.color} cursor-pointer hover:underline">
              Stack Trace
            </summary>
            <pre
              class="mt-2 text-xs font-mono text-subtle bg-background/50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-64">{errorStack}</pre>
          </details>
        {/if}
      </div>
    </div>
  {/if}
</div>
