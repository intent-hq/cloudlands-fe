<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faList } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';
  import ScrollToBottomButton from './ScrollToBottomButton.svelte';
  import type { UserMessageNavigationItem } from './chat-message-navigation';

  interface Props {
    messages: UserMessageNavigationItem[];
    isAtBottom: boolean;
    onSelectMessage: (messageId: string) => Promise<boolean> | boolean;
    onScrollToBottom: () => void;
  }

  let { messages, isAtBottom, onSelectMessage, onScrollToBottom }: Props = $props();
  let open = $state(false);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerInside = false;
  let suppressFocusOpen = false;
  let listRegion: HTMLDivElement | null = $state(null);
  let panelRegion: HTMLDivElement | null = $state(null);

  function containsNavigationTarget(target: Node | null) {
    return Boolean(target && (listRegion?.contains(target) || panelRegion?.contains(target)));
  }

  function clearHoverTimer() {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function openFromPointer() {
    pointerInside = true;
    clearHoverTimer();
    hoverTimer = setTimeout(() => {
      open = true;
    }, 120);
  }

  function closeFromPointer() {
    pointerInside = false;
    clearHoverTimer();
    hoverTimer = setTimeout(() => {
      if (!containsNavigationTarget(document.activeElement)) open = false;
    }, 180);
  }

  function handleFocusIn() {
    if (pointerInside || suppressFocusOpen) return;
    open = true;
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (containsNavigationTarget(next)) return;
    suppressFocusOpen = false;
    if (!pointerInside) open = false;
  }

  function handleEscapeCapture(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    pointerInside = false;
    suppressFocusOpen = true;
    open = false;
  }

  async function selectMessage(messageId: string) {
    suppressFocusOpen = true;
    await onSelectMessage(messageId);
    open = false;
  }

  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      const firstItem = panelRegion?.querySelector<HTMLElement>('[role="menuitem"]');
      const menu = panelRegion?.closest<HTMLElement>('[role="menu"]');
      (firstItem ?? menu)?.focus();
    });
  });

  $effect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containsNavigationTarget(event.target as Node)) {
        suppressFocusOpen = true;
        open = false;
      }
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  });

  onDestroy(clearHoverTimer);
</script>

<div class="flex shrink-0 items-center gap-0.5" data-testid="chat-header-navigation-controls">
  <div
    bind:this={listRegion}
    class="relative flex shrink-0"
    role="group"
    aria-label={m.chat_messageNavigator_open_ariaLabel()}
    onpointerenter={openFromPointer}
    onpointerleave={closeFromPointer}
    onfocusin={handleFocusIn}
    onfocusout={handleFocusOut}
    onkeydowncapture={handleEscapeCapture}
  >
    <DropdownMenu
      bind:open
      align="end"
      side="bottom"
      contentClass="w-[28rem] max-w-[calc(100vw-1rem)] p-1 focus-visible:border-border focus-visible:ring-0"
    >
      {#snippet trigger({ toggle, props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-lg"
          onclick={toggle}
          aria-label={m.chat_messageNavigator_open_ariaLabel()}
          title={m.chat_messageNavigator_open_ariaLabel()}
          aria-expanded={open}
          data-testid="chat-message-navigator-trigger"
        >
          <Fa icon={faList} size={20} />
        </Button>
      {/snippet}
      {#snippet content()}
        <div
          bind:this={panelRegion}
          class="max-h-80 min-w-0 overflow-y-auto"
          data-testid="chat-message-navigator-panel"
          role="presentation"
          onkeydowncapture={handleEscapeCapture}
          onpointerenter={() => {
            pointerInside = true;
            clearHoverTimer();
          }}
          onpointerleave={closeFromPointer}
        >
          {#each messages as message (message.id)}
            <Menu.Item
              class="min-w-0 overflow-hidden focus-visible:outline-none focus-visible:ring-0"
              textValue={message.text}
              onclick={() => void selectMessage(message.id)}
              aria-label={message.text}
              title={message.text}
              data-testid="chat-message-navigator-result"
              data-message-id={message.id}
            >
              <span class="type-caption block min-w-0 flex-1 truncate whitespace-nowrap">
                {message.text}
              </span>
            </Menu.Item>
          {:else}
            <div
              class="type-caption px-2 py-6 text-center text-muted-foreground"
              data-testid="chat-message-navigator-empty"
            >
              {m.chat_messageNavigator_empty_label()}
            </div>
          {/each}
        </div>
      {/snippet}
    </DropdownMenu>
  </div>
  <ScrollToBottomButton disabled={isAtBottom} onclick={onScrollToBottom} />
</div>
