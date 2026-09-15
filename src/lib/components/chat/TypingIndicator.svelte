<script lang="ts">
  import Fa from 'svelte-fa';
  import { faRobot } from '@fortawesome/free-solid-svg-icons';
  import { fade, scale } from '$lib/motion';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    size?: 'sm' | 'md' | 'lg';
    message?: string;
    showAvatar?: boolean;
  }

  let {
    size = 'md',
    message = m.chat_typingIndicator_typing_label(),
    showAvatar = true,
  }: Props = $props();

  const sizes = {
    sm: {
      container: 'px-3 py-2',
      loader: 16,
      avatar: 'w-5 h-5',
      text: 'text-xs',
    },
    md: {
      container: 'px-4 py-3',
      loader: 18,
      avatar: 'w-6 h-6',
      text: 'text-sm',
    },
    lg: {
      container: 'px-5 py-4',
      loader: 20,
      avatar: 'w-7 h-7',
      text: 'text-base',
    },
  };

  let sizeConfig = $derived(sizes[size]);
</script>

<div
  class="flex items-center gap-3 {sizeConfig.container} rounded-lg max-w-fit"
  in:fade={{ tier: 'moderate' }}
  out:scale={{ tier: 'moderate', distance: 0.05 }}
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

  <IntentMarkLoader size={sizeConfig.loader} />

  {#if message}
    <span class="{sizeConfig.text} text-subtle pr-1">{message}</span>
  {/if}
</div>
