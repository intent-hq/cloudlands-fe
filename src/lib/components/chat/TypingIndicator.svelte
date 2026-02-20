<script lang="ts">
  import Fa from 'svelte-fa';
  import { faRobot } from '@fortawesome/free-solid-svg-icons';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Spinner } from '$lib/components/ui/indicators';

  interface Props {
    size?: 'sm' | 'md' | 'lg';
    message?: string;
    showAvatar?: boolean;
    /** Seed for spinner colors (e.g., agent ID) */
    seed?: string;
  }

  let {
    size = 'md',
    message = 'Assistant is typing...',
    showAvatar = true,
    seed = 'default',
  }: Props = $props();

  const sizes = {
    sm: {
      container: 'px-3 py-2',
      spinner: 5,
      avatar: 'w-5 h-5',
      text: 'text-xs',
    },
    md: {
      container: 'px-4 py-3',
      spinner: 6,
      avatar: 'w-6 h-6',
      text: 'text-sm',
    },
    lg: {
      container: 'px-5 py-4',
      spinner: 7,
      avatar: 'w-7 h-7',
      text: 'text-base',
    },
  };

  let sizeConfig = $derived(sizes[size]);
</script>

<div
  class="flex items-center gap-3 {sizeConfig.container} rounded-lg max-w-fit"
  in:fade={{ duration: 200, easing: cubicOut }}
  out:scale={{ duration: 150, start: 0.95, easing: cubicOut }}
>
  {#if showAvatar}
    <div
      class="{sizeConfig.avatar} rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-sm"
    >
      <Fa
        icon={faRobot}
        size={size === 'sm' ? 'xs' : size === 'md' ? 'sm' : '1x'}
        class="text-white"
      />
    </div>
  {/if}

  <Spinner {seed} size={sizeConfig.spinner} />

  {#if message}
    <span class="{sizeConfig.text} text-muted-foreground pr-1">{message}</span>
  {/if}
</div>
