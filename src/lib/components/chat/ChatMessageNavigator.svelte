<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faList } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';
  import ScrollToBottomButton from './ScrollToBottomButton.svelte';
  import {
    filterUserMessageNavigationItems,
    type UserMessageNavigationItem,
  } from './chat-message-navigation';

  interface Props {
    messages: UserMessageNavigationItem[];
    isAtBottom: boolean;
    onSelectMessage: (messageId: string) => Promise<boolean> | boolean;
    onScrollToBottom: () => void;
  }

  let { messages, isAtBottom, onSelectMessage, onScrollToBottom }: Props = $props();
  let open = $state(false);
  let query = $state('');
  let searchInput: HTMLInputElement | null = $state(null);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerInside = false;
  let suppressFocusOpen = false;
  let focusSearchOnOpen = false;
  let listRegion: HTMLDivElement | null = $state(null);
  let panelRegion: HTMLDivElement | null = $state(null);
  const filteredMessages = $derived(filterUserMessageNavigationItems(messages, query));

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
      focusSearchOnOpen = false;
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
    focusSearchOnOpen = true;
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
    if (!open) {
      query = '';
      return;
    }
    if (focusSearchOnOpen) {
      void tick().then(() => searchInput?.focus());
    }
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
    <DropdownMenu bind:open align="end" side="bottom" contentClass="w-72 p-0">
      {#snippet trigger({ toggle, props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-lg"
          onclick={() => {
            focusSearchOnOpen = true;
            toggle();
          }}
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
          class="flex min-w-0 flex-col"
          data-testid="chat-message-navigator-panel"
          role="presentation"
          onkeydowncapture={handleEscapeCapture}
          onpointerenter={() => {
            pointerInside = true;
            clearHoverTimer();
          }}
          onpointerleave={closeFromPointer}
        >
          <div class="border-b border-border p-2">
            <Input
              bind:ref={searchInput}
              bind:value={query}
              type="search"
              placeholder={m.chat_messageNavigator_search_placeholder()}
              aria-label={m.chat_messageNavigator_search_ariaLabel()}
              data-testid="chat-message-navigator-search"
            />
          </div>
          <div class="max-h-72 min-w-0 overflow-y-auto p-1" role="listbox">
            {#each filteredMessages as message (message.id)}
              <Menu.Item
                class="min-w-0 overflow-hidden"
                onclick={() => void selectMessage(message.id)}
                aria-label={message.text}
                title={message.text}
                data-testid="chat-message-navigator-result"
                data-message-id={message.id}
              >
                <span class="block min-w-0 flex-1 truncate whitespace-nowrap">{message.text}</span>
              </Menu.Item>
            {:else}
              <div
                class="px-2 py-6 text-center text-sm text-muted-foreground"
                data-testid="chat-message-navigator-empty"
              >
                {m.chat_messageNavigator_empty_label()}
              </div>
            {/each}
          </div>
        </div>
      {/snippet}
    </DropdownMenu>
  </div>
  <ScrollToBottomButton disabled={isAtBottom} onclick={onScrollToBottom} />
</div>
