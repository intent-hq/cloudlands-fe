<script lang="ts">
  /**
   * Loading Shimmer Component
   *
   * Provides a smooth shimmer effect for loading states
   * Uses the user's preferred transparent to --color-sidebar gradient
   */

  interface Props {
    lines?: number;
    showHeader?: boolean;
    showSidebar?: boolean;
    class?: string;
  }

  let {
    lines = 5,
    showHeader = false,
    showSidebar = false,
    class: className = '',
  }: Props = $props();

  const shimmerBase =
    'h-4 rounded bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-pulse [animation-duration:1.5s] opacity-10 dark:opacity-5 dark:via-foreground/5';
  const titleClass = `${shimmerBase} h-6 w-[40%] mb-2`;
  const subtitleClass = `${shimmerBase} h-4 w-[60%] opacity-10 dark:opacity-5`;
  const navItemClass = `${shimmerBase} h-8 w-[80%] mb-1`;
  const contentClasses = $derived(
    showSidebar ? 'grid grid-cols-[200px,1fr] gap-8' : 'flex flex-col gap-3',
  );
</script>

<div class={`w-full h-full p-4 ${className}`}>
  {#if showHeader}
    <div class="mb-8">
      <div class={titleClass}></div>
      <div class={subtitleClass}></div>
    </div>
  {/if}

  <div class={contentClasses}>
    {#if showSidebar}
      <div class="flex flex-col gap-2">
        {#each Array(3) as _, i}
          <div class={navItemClass}></div>
        {/each}
      </div>
    {/if}

    <div class="flex-1 flex flex-col gap-3">
      {#each Array(lines) as _, i}
        <div class={shimmerBase} style={`width:${85 + Math.random() * 15}%`}></div>
      {/each}
    </div>
  </div>
</div>
