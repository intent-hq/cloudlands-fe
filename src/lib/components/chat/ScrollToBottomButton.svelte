<script lang="ts">
  import { faArrowDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { CHAT_ICON_SIZE } from './chat-icon-size';

  interface Props {
    onclick: () => void;
  }

  let { onclick }: Props = $props();
  const label = $derived(m.chat_chatPanel_scrollToBottom_tooltip());
</script>

<button
  type="button"
  data-testid="chat-scroll-to-bottom-button"
  {onclick}
  class="type-body absolute z-[45] inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:bg-muted/70 focus-visible:text-foreground active:scale-95"
  style="width: var(--control-height-large); height: var(--control-height-large); bottom: max(var(--space-2), env(safe-area-inset-bottom, 0px)); left: max(var(--space-2), env(safe-area-inset-left, 0px));"
  data-icon-size={CHAT_ICON_SIZE.default}
  aria-label={label}
  title={label}
>
  <Fa icon={faArrowDown} size={CHAT_ICON_SIZE.default} />
</button>
