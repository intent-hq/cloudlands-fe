<script lang="ts">
  /**
   * McpIcon - Icon component for MCP server presets
   *
   * Uses Simple Icons CDN for brand logos with fallback to initials.
   * Icons are displayed at full opacity.
   */
  import {
  faServer,
  faBrain,
  faDatabase,
  faCloud,
  faCog,
} from '@fortawesome/free-solid-svg-icons';
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
    redis: 'redis',
    mongodb: 'mongodb',
    circleci: 'circleci',
    vercel: 'vercel',
    railway: 'railway',
    convex: 'convex',
    snowflake: 'snowflake',
    sentry: 'sentry',
    figma: 'figma',
    github: 'github',
    linear: 'linear',
  };

  // Map specific icon names to custom image URLs (for icons that need color)
  const customIconUrls: Record<string, string> = {
    figma: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Figma-logo.svg/960px-Figma-logo.svg.png',
    playwright: 'https://ray.run/playwright-brand-assets/playwright-logo.svg',
  };

  // Map icon names to inline SVG strings (for icons that need custom rendering)
  const customIconSvgs: Record<string, string> = {
    context7: '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 0C26.2091 0 28 1.79086 28 4V24C28 26.2091 26.2091 28 24 28H4C1.79086 28 0 26.2091 0 24V4C0 1.79086 1.79086 0 4 0H24ZM8.58008 15.2559C8.58008 17.8621 7.95482 19.3557 6.33398 21.1885V22.7783H11.6309V21.1045H8.17773C9.66098 19.3776 10.5723 17.5019 10.5723 15.2559H8.58008ZM17.4268 15.2559C17.4268 17.5019 18.338 19.3776 19.8213 21.1045H16.3672V22.7783H21.6641V21.1885C20.0433 19.3558 19.4189 17.862 19.4189 15.2559H17.4268ZM6.33398 6.80957C7.95495 8.64244 8.58008 10.137 8.58008 12.7432H10.5713C10.5713 10.4972 9.66094 8.62143 8.17773 6.89453H11.6309V5.2207H6.33398V6.80957ZM16.3672 5.2207V6.89453H19.8213C18.338 8.62145 17.4268 10.4972 17.4268 12.7432H19.4189C19.4189 10.137 20.0432 8.64242 21.6641 6.80957V5.2207H16.3672Z" fill="black"/></svg>',
    slack: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0" fill="#de1c59"/><path d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0" fill="#35c5f0"/><path d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0" fill="#2eb57d"/><path d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0" fill="#ebb02e"/></svg>',
  };

  // Icons that should be inverted in dark mode (e.g., black logos)
  const invertInDarkMode = new Set(['context7', 'github', 'linear']);

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

  // Get inline SVG if available
  const inlineSvg = $derived(customIconSvgs[iconName.toLowerCase()] || null);

  // Check if icon needs dark mode inversion
  const needsInvert = $derived(invertInDarkMode.has(iconName.toLowerCase()));

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
  {#if inlineSvg}
    <div
      class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full {needsInvert ? 'dark:invert' : ''}"
    >
      {@html inlineSvg}
    </div>
  {:else if iconUrl && !imageError}
    <img
      src={iconUrl}
      alt={label}
      class="w-full h-full object-contain {needsInvert ? 'dark:invert' : ''}"
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
