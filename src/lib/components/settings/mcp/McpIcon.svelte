<script lang="ts">
  /**
   * McpIcon - Icon component for MCP server presets
   *
   * Uses Simple Icons CDN for brand logos with fallback to initials.
   * Icons are displayed at full opacity.
   */
  import { faServer, faBrain, faDatabase, faCloud, faCog } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    iconName: string;
    label: string;
    size?: number;
    class?: string;
  }

  let { iconName, label, size = 20, class: className = '' }: Props = $props();

  // Map icon names to Simple Icons slugs (case-sensitive)
  const simpleIconsMap: Record<string, string> = {
    slack: 'slack',
    redis: 'redis',
    mongodb: 'mongodb',
    circleci: 'circleci',
    vercel: 'vercel',
    railway: 'railway',
    convex: 'convex',
    snowflake: 'snowflake',
    context7: 'upstash',
    playwright: 'playwright',
    sentry: 'sentry',
    figma: 'figma',
  };

  // Map specific icon names to custom image URLs (for icons that need color)
  const customIconUrls: Record<string, string> = {
    figma: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Figma-logo.svg/960px-Figma-logo.svg.png',
  };

  // Map icon names to FontAwesome icons as fallback
  const faIconMap: Record<string, typeof faServer> = {
    brain: faBrain,
    server: faServer,
    database: faDatabase,
    cloud: faCloud,
    default: faCog,
  };

  // Get Simple Icons slug
  const simpleIconSlug = $derived(simpleIconsMap[iconName.toLowerCase()]);

  // Get FontAwesome icon fallback
  const faIcon = $derived(faIconMap[iconName.toLowerCase()] || faIconMap.default);

  // Image load state
  let imageLoaded = $state(false);
  let imageError = $state(false);

  // Icon URL - prefer custom URLs for colorful logos, then Simple Icons CDN
  const iconUrl = $derived(
    customIconUrls[iconName.toLowerCase()] ||
    (simpleIconSlug ? `https://cdn.simpleicons.org/${simpleIconSlug}` : null)
  );

  function handleLoad() {
    imageLoaded = true;
  }

  function handleError() {
    imageError = true;
  }
</script>

<div
  class="flex items-center justify-center shrink-0 {className}"
  style="width: {size}px; height: {size}px;"
>
  {#if iconUrl && !imageError}
    <img
      src={iconUrl}
      alt={label}
      class="w-full h-full object-contain"
      class:opacity-0={!imageLoaded}
      onload={handleLoad}
      onerror={handleError}
    />
    {#if !imageLoaded}
      <!-- Show initial while loading -->
      <span
        class="absolute text-subtle font-medium"
        style="font-size: {size * 0.45}px;"
      >
        {label.charAt(0)}
      </span>
    {/if}
  {:else if faIconMap[iconName.toLowerCase()]}
    <Fa icon={faIcon} class="text-ghost" style="font-size: {size * 0.7}px;" />
  {:else}
    <!-- Fallback to initial -->
    <span
      class="text-subtle font-medium"
      style="font-size: {size * 0.45}px;"
    >
      {label.charAt(0)}
    </span>
  {/if}
</div>
