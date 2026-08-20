<script lang="ts">
  import { Popover } from 'bits-ui';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import { faList } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
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
  let query = $state('');
  let activeIndex = $state(0);
  let searchInput: HTMLInputElement | null = $state(null);
  let triggerElement: HTMLElement | null = $state(null);
  let contentElement: HTMLElement | null = $state(null);
  let collisionBoundary: Element[] = $state([]);
  let pointerDownOnTrigger = $state(false);
  let preserveOutsideFocusOnClose = $state(false);
  let reopenOnNextPointerIntent = $state(false);
  let suppressNextTriggerClick = $state(false);
  let lastTriggerPointerPosition: { pointerId: number; x: number; y: number } | null = $state(null);
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
    if (!nextOpen) {
      suppressNextTriggerClick = false;
      return;
    }
    const panel = triggerElement?.closest('[data-panel-id]');
    collisionBoundary = panel ? [panel] : [];
    reopenOnNextPointerIntent = false;
    query = '';
    activeIndex = 0;
  }

  function handleInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    activeIndex = 0;
  }

  function handleTriggerFocus(event: FocusEvent) {
    const previousTarget = event.relatedTarget;
    if (
      pointerDownOnTrigger ||
      (previousTarget instanceof Element && previousTarget.closest('[data-popover-content]'))
    ) {
      return;
    }
    handleOpenChange(true);
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!open) handleOpenChange(true);
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

  function handleWindowFocusIn(event: FocusEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (triggerElement?.contains(event.target) || isNavigatorContentTarget(event.target)) return;
    pointerDownOnTrigger = false;
    preserveOutsideFocusOnClose = true;
    reopenOnNextPointerIntent = true;
    handleOpenChange(false);
  }

  function rememberTriggerPointerPosition(event: PointerEvent) {
    lastTriggerPointerPosition = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function reopenFromPointerIntent() {
    pointerDownOnTrigger = true;
    triggerElement?.focus({ preventScroll: true });
    pointerDownOnTrigger = false;
    handleOpenChange(true);
  }

  function handleTriggerPointerOver(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    const enteredFromOutside =
      !(event.relatedTarget instanceof Node) || !triggerElement?.contains(event.relatedTarget);
    rememberTriggerPointerPosition(event);
    if (reopenOnNextPointerIntent && enteredFromOutside) {
      reopenFromPointerIntent();
      suppressNextTriggerClick = true;
    }
  }

  function handleTriggerPointerDown() {
    pointerDownOnTrigger = true;
    if (suppressNextTriggerClick) {
      suppressNextTriggerClick = false;
      open = false;
    }
  }

  function handleTriggerPointerEnter(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    rememberTriggerPointerPosition(event);
  }

  function handleTriggerPointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    const moved =
      lastTriggerPointerPosition !== null &&
      (lastTriggerPointerPosition.pointerId !== event.pointerId ||
        lastTriggerPointerPosition.x !== event.clientX ||
        lastTriggerPointerPosition.y !== event.clientY);
    rememberTriggerPointerPosition(event);
    if (reopenOnNextPointerIntent && moved) reopenFromPointerIntent();
  }

  function handleTriggerPointerLeave(event: PointerEvent) {
    if (event.pointerType !== 'touch') {
      lastTriggerPointerPosition = null;
      suppressNextTriggerClick = false;
    }
  }

  function handleCloseAutoFocus(event: Event) {
    if (!preserveOutsideFocusOnClose) return;
    event.preventDefault();
    preserveOutsideFocusOnClose = false;
  }

  async function selectMessage(messageId: string) {
    await onSelectMessage(messageId);
    open = false;
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
      activeIndex = (activeIndex + 1) % filteredMessages.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + filteredMessages.length) % filteredMessages.length;
    } else if (event.key === 'Home') {
      event.preventDefault();
      activeIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      activeIndex = filteredMessages.length - 1;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void selectMessage(filteredMessages[activeIndex].id);
    }
  }
</script>

<svelte:window onfocusincapture={handleWindowFocusIn} />

<div class="flex shrink-0 items-center gap-0" data-testid="chat-header-navigation-controls">
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <Popover.Trigger
      bind:ref={triggerElement}
      openOnHover
      openDelay={120}
      closeDelay={180}
      onpointerover={handleTriggerPointerOver}
      onpointerenter={handleTriggerPointerEnter}
      onpointermove={handleTriggerPointerMove}
      onpointerleave={handleTriggerPointerLeave}
    >
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          aria-label={m.chat_messageNavigator_open_ariaLabel()}
          tooltip={m.chat_messageNavigator_open_ariaLabel()}
          tooltipSide="bottom"
          tooltipDelayDuration={300}
          aria-expanded={open}
          onfocus={handleTriggerFocus}
          onkeydown={handleTriggerKeydown}
          onpointerdown={handleTriggerPointerDown}
          onpointerup={() => (pointerDownOnTrigger = false)}
          onpointercancel={() => (pointerDownOnTrigger = false)}
          data-testid="chat-message-navigator-trigger"
        >
          <Fa icon={faList} size={14} class="size-3.5!" />
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
        data-chat-message-navigator-content={navigatorId}
        class="z-(--layer-popover) flex min-w-0 max-h-[var(--bits-popover-content-available-height)] w-[28rem] max-w-[min(calc(100vw-var(--space-4)),calc(var(--bits-popover-content-available-width)-var(--space-2)))] flex-col overflow-hidden rounded-(--radius-medium) border border-border bg-popover p-[var(--space-1)] text-popover-foreground shadow-(--elevation-overlay) outline-none"
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
          {#if filteredMessages.length > 0}
            <div
              id={listboxId}
              role="listbox"
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
                    onpointerenter={() => (activeIndex = index)}
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
          {:else}
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
