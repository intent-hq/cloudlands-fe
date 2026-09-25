<script lang="ts">
  import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { CHAT_ICON_SIZE } from './chat-icon-size';

  interface Props {
    onclick: () => void;
    disabled?: boolean;
  }

  let { onclick, disabled = false }: Props = $props();
  const label = $derived(m.chat_chatPanel_scrollToBottom_tooltip());
</script>

<Button
  variant="ghost-light"
  size="icon-sm"
  data-testid="chat-scroll-to-bottom-button"
  {onclick}
  {disabled}
  data-icon-size={CHAT_ICON_SIZE.compact}
  aria-label={label}
  tooltip={label}
  tooltipSide="bottom"
  tooltipDelayDuration={300}
>
  <ArrowDownIcon
    size={CHAT_ICON_SIZE.compact}
    weight="regular"
    aria-hidden="true"
    class="size-4!"
  />
</Button>
