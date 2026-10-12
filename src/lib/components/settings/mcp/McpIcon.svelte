<script lang="ts">
  /**
   * McpIcon - Icon component for MCP server presets
   *
   * Uses Simple Icons CDN for brand logos with fallback to initials.
   * Icons are displayed at full opacity.
   */
  import Fa from 'svelte-fa';
  import {
    simpleIconsMap,
    customIconUrls,
    customIconSvgs,
    invertInDarkMode,
    faIconMap,
  } from './mcp-icon-data';

  interface Props {
    iconName: string;
    label: string;
    size?: number;
    class?: string;
  }

  let { iconName, label, size = 20, class: className = '' }: Props = $props();

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
      (simpleIconSlug ? `https://cdn.simpleicons.org/${simpleIconSlug}` : null),
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
      class="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full {needsInvert
        ? 'dark:invert'
        : ''}"
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
        class="type-caption absolute text-subtle font-medium"
        style="font-size: {size * 0.45}px;"
      >
        {label.charAt(0)}
      </span>
    {/if}
  {:else if faIconMap[iconName.toLowerCase()]}
    <Fa icon={faIcon} class="text-ghost" style="font-size: {size * 0.7}px;" />
  {:else}
    <!-- Fallback to initial -->
    <span class="type-caption text-subtle font-medium" style="font-size: {size * 0.45}px;">
      {label.charAt(0)}
    </span>
  {/if}
</div>
