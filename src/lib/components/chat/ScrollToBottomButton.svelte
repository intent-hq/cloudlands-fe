<script lang="ts">
  import { faArrowDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
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
  class="rounded-md text-muted-foreground shadow-none focus-visible:border-border focus-visible:bg-muted focus-visible:ring-0 disabled:opacity-40"
  data-icon-size={CHAT_ICON_SIZE.compact}
  aria-label={label}
  tooltip={label}
  tooltipSide="bottom"
  tooltipDelayDuration={300}
>
  <Fa icon={faArrowDown} size={CHAT_ICON_SIZE.compact} class="size-4!" />
</Button>
