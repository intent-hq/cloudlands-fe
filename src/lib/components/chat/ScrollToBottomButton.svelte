<script lang="ts">
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { CHAT_ICON_SIZE } from './chat-icon-size';

  interface Props {
    onclick: () => void;
    disabled?: boolean;
    floating?: boolean;
  }

  let { onclick, disabled = false, floating = false }: Props = $props();
  const label = $derived(m.chat_chatPanel_scrollToBottom_tooltip());
</script>

<Button
  variant={floating ? 'outline' : 'ghost-light'}
  size={floating ? 'icon' : 'icon-sm'}
  class={floating ? 'rounded-full bg-background shadow-(--elevation-raised)' : undefined}
  data-testid={floating ? 'chat-floating-scroll-to-bottom-button' : 'chat-scroll-to-bottom-button'}
  {onclick}
  {disabled}
  data-icon-size={CHAT_ICON_SIZE.compact}
  aria-label={label}
  tooltip={label}
  tooltipSide={floating ? 'top' : 'bottom'}
  tooltipDelayDuration={300}
>
  <ArrowDownIcon
    size={CHAT_ICON_SIZE.compact}
    weight="regular"
    aria-hidden="true"
    class="size-4!"
  />
</Button>
