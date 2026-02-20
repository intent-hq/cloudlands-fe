<script lang="ts">
  /**
   * ProviderIcon - Unified icon component for context providers
   *
   * Renders the appropriate icon based on provider type:
   * - linear: Linear logo
   * - github: GitHub logo
   * - sentry: Sentry logo
   * - browser: Globe icon
   * - internal: Document icon (for notes)
   */
  import type { ContextProvider, ContextItemType } from '$features/context/types';
  import { CONTEXT_ITEM_PROVIDERS } from '$features/context/types';
  import LinearIcon from './LinearIcon.svelte';
  import GitHubIcon from './GitHubIcon.svelte';
  import SentryIcon from './SentryIcon.svelte';
  import Fa from 'svelte-fa';
  import { faGlobe, faFileAlt } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    /** Provider type */
    provider?: ContextProvider;
    /** Alternatively, specify by item type */
    itemType?: ContextItemType;
    /** Icon size in pixels */
    size?: number;
    /** Additional CSS classes */
    class?: string;
  }

  let { provider, itemType, size = 16, class: className = '' }: Props = $props();

  // Derive provider from itemType if not specified
  const effectiveProvider = $derived(
    provider ?? (itemType ? CONTEXT_ITEM_PROVIDERS[itemType] : 'internal'),
  );
</script>

{#if effectiveProvider === 'linear'}
  <LinearIcon {size} class={className} />
{:else if effectiveProvider === 'github'}
  <GitHubIcon {size} class={className} />
{:else if effectiveProvider === 'sentry'}
  <SentryIcon {size} class={className} />
{:else if effectiveProvider === 'browser'}
  <span class={className} style="width: {size}px; height: {size}px; display: inline-flex; align-items: center; justify-content: center;">
    <Fa icon={faGlobe} size="{size}px" />
  </span>
{:else}
  <!-- internal / note -->
  <span class={className} style="width: {size}px; height: {size}px; display: inline-flex; align-items: center; justify-content: center;">
    <Fa icon={faFileAlt} size="{size}px" />
  </span>
{/if}
