<script lang="ts">
  import { faArrowDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { CHAT_ICON_SIZE } from './chat-icon-size';

  interface Props {
    onclick: () => void;
    disabled?: boolean;
  }

  let { onclick, disabled = false }: Props = $props();
  const label = $derived(m.chat_chatPanel_scrollToBottom_tooltip());
</script>

<button
  type="button"
  data-testid="chat-scroll-to-bottom-button"
  {onclick}
  {disabled}
  class="type-body inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:border-border focus-visible:bg-muted focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40"
  data-icon-size={CHAT_ICON_SIZE.navigationArrow}
  aria-label={label}
  title={label}
>
  <Fa icon={faArrowDown} size={CHAT_ICON_SIZE.navigationArrow} class="size-[11px]!" />
</button>
