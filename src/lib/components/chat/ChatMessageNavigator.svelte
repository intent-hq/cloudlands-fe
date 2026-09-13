<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Popover } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import ChatTextIcon from 'phosphor-svelte/lib/ChatTextIcon';
  import { Button } from '$lib/components/ui/button';
  import { DROPDOWN_SURFACE_CLASS } from '$lib/components/ui/dropdown-surface';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { Spinner } from '$lib/components/ui/indicators';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import ScrollToBottomButton from './ScrollToBottomButton.svelte';
  import type { UserMessageNavigationItem } from './chat-message-navigation';

  interface Props {
    messages: UserMessageNavigationItem[];
    isAtBottom: boolean;
    onSelectMessage: (messageId: string) => Promise<boolean> | boolean;
    onScrollToBottom: () => void;
    /** Called each time the popover opens (used to refresh the full-history index). */
    onOpen?: () => void;
    /** True while the full-history index fetch is in flight (no cached index yet). */
    isLoadingIndex?: boolean;
  }

  let {
    messages,
    isAtBottom,
    onSelectMessage,
    onScrollToBottom,
    onOpen,
    isLoadingIndex = false,
  }: Props = $props();
  let open = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  // While true the newest (last) item stays active even as async index rows
  // are prepended; cleared once the user scrolls or moves the active item.
  let anchorToEnd = $state(true);
  // Identity of the active option so prepended index rows cannot silently
  // change which message activeIndex points at once the anchor is released.
  let activeMessageId: string | null = null;
  // True while the scroll-into-view effect below scrolls programmatically, so
  // its own scroll events do not release the end anchor.
  let suppressScrollRelease = false;
  let searchInput: HTMLInputElement | null = $state(null);
  let triggerElement: HTMLElement | null = $state(null);
  let contentElement: HTMLElement | null = $state(null);
  let collisionBoundary: Element[] = $state([]);
  let preserveOutsideFocusOnClose = $state(false);
  const navigatorId = $props.id();
  const listboxId = `chat-message-navigator-listbox-${navigatorId}`;
  const filteredMessages = $derived.by(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return messages;
    return messages.filter((message) => message.text.toLocaleLowerCase().includes(normalizedQuery));
  });
  const activeOptionId = $derived(
    filteredMessages.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined,
  );

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    if (!nextOpen) return;
    const panel = triggerElement?.closest('[data-panel-id]');
    collisionBoundary = panel ? [panel] : [];
    query = '';
    anchorToEnd = true;
    activeIndex = Math.max(messages.length - 1, 0);
    onOpen?.();
  }

  function handleInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    anchorToEnd = true;
    activeIndex = Math.max(filteredMessages.length - 1, 0);
  }

  function moveActiveTo(index: number) {
    anchorToEnd = false;
    activeIndex = index;
    activeMessageId = filteredMessages[index]?.id ?? null;
  }

  function handleListboxScroll() {
    if (suppressScrollRelease) return;
    anchorToEnd = false;
  }

  // Keep the newest item active (and the list anchored at the bottom) while
  // the user has not interacted, so the async index fetch prepending older
  // rows does not yank the selection off the end. Once released, follow the
  // active message by identity so prepends cannot shift what Enter selects.
  $effect(() => {
    if (!open) return;
    const count = filteredMessages.length;
    if (count === 0) return;
    if (anchorToEnd) {
      activeIndex = count - 1;
      activeMessageId = filteredMessages[count - 1].id;
      return;
    }
    const currentIndex = untrack(() => activeIndex);
    const preservedIndex =
      activeMessageId === null
        ? -1
        : filteredMessages.findIndex((message) => message.id === activeMessageId);
    if (preservedIndex >= 0) {
      if (preservedIndex !== currentIndex) activeIndex = preservedIndex;
    } else if (currentIndex >= count) {
      activeIndex = count - 1;
      activeMessageId = filteredMessages[count - 1].id;
    } else {
      activeMessageId = filteredMessages[currentIndex]?.id ?? null;
    }
  });

  // Keep the active option visible whenever it or the list changes. The
  // suppress flag spans the resulting scroll event (scroll events fire before
  // the next animation frame) so programmatic scrolls keep the end anchor.
  $effect(() => {
    if (!open || !contentElement || filteredMessages.length === 0) return;
    const option = document.getElementById(`${listboxId}-option-${activeIndex}`);
    if (!option) return;
    suppressScrollRelease = true;
    option.scrollIntoView?.({ block: 'nearest' });
    requestAnimationFrame(() => {
      suppressScrollRelease = false;
    });
  });

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenChange(!open);
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    searchInput?.focus();
  }

  function isNavigatorContentTarget(target: Node): boolean {
    if (contentElement?.contains(target)) return true;
    if (!(target instanceof Element)) return false;
    const ownerContent = target.closest<HTMLElement>('[data-chat-message-navigator-content]');
    return ownerContent?.dataset.chatMessageNavigatorContent === navigatorId;
  }

  function handleFocusOutside(event: FocusEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (triggerElement?.contains(event.target) || isNavigatorContentTarget(event.target)) return;
    preserveOutsideFocusOnClose = true;
    handleOpenChange(false);
  }

  function handleCloseAutoFocus(event: Event) {
    if (!preserveOutsideFocusOnClose) return;
    event.preventDefault();
    preserveOutsideFocusOnClose = false;
  }

  async function selectMessage(messageId: string) {
    open = false;
    await tick();
    await onSelectMessage(messageId);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      return;
    }
    if (filteredMessages.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveTo((activeIndex + 1) % filteredMessages.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveTo((activeIndex - 1 + filteredMessages.length) % filteredMessages.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActiveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActiveTo(filteredMessages.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void selectMessage(filteredMessages[activeIndex].id);
    }
  }
</script>

<div class="flex shrink-0 items-center gap-0" data-testid="chat-header-navigation-controls">
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <Popover.Trigger bind:ref={triggerElement}>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          aria-label={m.chat_messageNavigator_open_ariaLabel()}
          tooltip={m.chat_messageNavigator_open_ariaLabel()}
          tooltipDisabled={open}
          tooltipSide="bottom"
          tooltipDelayDuration={300}
          aria-expanded={open}
          onkeydown={handleTriggerKeydown}
          data-testid="chat-message-navigator-trigger"
        >
          <ChatTextIcon
            size={14}
            mirrored
            aria-hidden="true"
            class="size-3.5!"
            data-chat-message-navigator-chat-icon
          />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        bind:ref={contentElement}
        role="dialog"
        aria-label={m.chat_messageNavigator_open_ariaLabel()}
        align="end"
        side="bottom"
        sideOffset={4}
        {collisionBoundary}
        collisionPadding={8}
        trapFocus={false}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onFocusOutside={handleFocusOutside}
        data-chat-message-navigator-content={navigatorId}
        class="{DROPDOWN_SURFACE_CLASS} w-[28rem]"
      >
        <div
          class="flex min-h-0 min-w-0 max-h-full flex-1 flex-col overflow-hidden"
          data-testid="chat-message-navigator-panel"
        >
          <Input
            bind:ref={searchInput}
            value={query}
            oninput={handleInput}
            onkeydown={handleSearchKeydown}
            role="combobox"
            aria-label={m.chat_messageNavigator_search_ariaLabel()}
            aria-controls={listboxId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autocomplete="off"
            placeholder={m.chat_messageNavigator_search_placeholder()}
            class="type-caption h-(--control-height-medium) w-full min-w-0 shrink-0 rounded-(--radius-small) border border-border bg-card px-[var(--space-2)] text-foreground caret-foreground outline-none placeholder:text-muted-foreground/70"
            data-testid="chat-message-navigator-search"
          />
          <!-- Persistent live region: announcements only fire for content
               changes inside an already-rendered live region, so the container
               stays mounted and only the loading row toggles. -->
          <div
            role="status"
            aria-live="polite"
            class="shrink-0"
            data-testid="chat-message-navigator-loading-region"
          >
            {#if isLoadingIndex}
              <div
                class="type-caption flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-muted-foreground"
                data-testid="chat-message-navigator-loading"
              >
                <Spinner />
                <span>{m.chat_messageNavigator_loading_label()}</span>
              </div>
            {/if}
          </div>
          {#if filteredMessages.length > 0}
            <div
              id={listboxId}
              role="listbox"
              onscroll={handleListboxScroll}
              class="mt-[var(--space-1)] min-h-0 min-w-0 flex-1 max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain"
            >
              {#each filteredMessages as message, index (message.id)}
                <Tooltip
                  content={message.text}
                  side="left"
                  align="center"
                  delayDuration={300}
                  size="sm"
                  class="block h-(--control-height-large) w-full min-w-0 max-w-full"
                  contentClass="max-w-[min(28rem,calc(100vw-var(--space-4)))] break-words text-left"
                >
                  <button
                    type="button"
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    tabindex="-1"
                    aria-selected={index === activeIndex}
                    class={cn(
                      'type-caption flex h-(--control-height-large) min-h-(--control-height-large) max-h-(--control-height-large) w-full min-w-0 max-w-full cursor-pointer items-center overflow-hidden rounded-(--radius-small) px-[var(--space-2)] text-left font-normal text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-(--motion-fast) hover:bg-accent/60 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none',
                      index === activeIndex && 'bg-accent text-accent-foreground',
                    )}
                    onclick={() => void selectMessage(message.id)}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void selectMessage(message.id);
                      }
                    }}
                    onpointermove={() => {
                      if (activeIndex !== index || anchorToEnd) moveActiveTo(index);
                    }}
                    data-testid="chat-message-navigator-result"
                    data-navigation-message-id={message.id}
                  >
                    <span
                      class="block min-w-0 max-w-full flex-1 overflow-hidden whitespace-nowrap text-left text-ellipsis font-normal"
                    >
                      {message.text}
                    </span>
                  </button>
                </Tooltip>
              {/each}
            </div>
          {:else if !isLoadingIndex}
            <div
              class="type-caption px-2 py-6 text-center text-muted-foreground"
              data-testid="chat-message-navigator-empty"
            >
              {m.chat_messageNavigator_empty_label()}
            </div>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
  <ScrollToBottomButton disabled={isAtBottom} onclick={onScrollToBottom} />
</div>
