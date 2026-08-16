<script lang="ts">
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import { faList } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import ScrollToBottomButton from './ScrollToBottomButton.svelte';
  import { CHAT_ICON_SIZE } from './chat-icon-size';
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
  let pointerDownOnTrigger = $state(false);
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

<div class="flex shrink-0 items-center gap-0.5" data-testid="chat-header-navigation-controls">
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <Popover.Trigger openOnHover openDelay={120} closeDelay={180}>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-lg"
          class="focus-visible:border-border focus-visible:bg-muted focus-visible:ring-0"
          aria-label={m.chat_messageNavigator_open_ariaLabel()}
          title={m.chat_messageNavigator_open_ariaLabel()}
          aria-expanded={open}
          onfocus={handleTriggerFocus}
          onkeydown={handleTriggerKeydown}
          onpointerdown={() => (pointerDownOnTrigger = true)}
          onpointerup={() => (pointerDownOnTrigger = false)}
          onpointercancel={() => (pointerDownOnTrigger = false)}
          data-testid="chat-message-navigator-trigger"
        >
          <Fa icon={faList} size={CHAT_ICON_SIZE.header} class="size-3!" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        role="dialog"
        aria-label={m.chat_messageNavigator_open_ariaLabel()}
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        onOpenAutoFocus={handleOpenAutoFocus}
        class="z-(--layer-popover) w-[28rem] max-w-[calc(100vw-1rem)] rounded-(--radius-medium) border border-border bg-popover p-1 text-popover-foreground shadow-(--elevation-overlay) outline-none"
      >
        <div class="min-w-0" data-testid="chat-message-navigator-panel">
          <input
            bind:this={searchInput}
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
            class="type-caption h-8 w-full rounded-(--radius-small) border border-border bg-card px-2 text-foreground outline-none placeholder:text-muted-foreground/70 hover:border-input focus-visible:border-foreground/40 focus-visible:ring-0"
            data-testid="chat-message-navigator-search"
          />
          {#if filteredMessages.length > 0}
            <div
              id={listboxId}
              role="listbox"
              class="mt-1 max-h-72 min-w-0 overflow-y-auto overscroll-contain"
            >
              {#each filteredMessages as message, index (message.id)}
                <button
                  type="button"
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  tabindex="-1"
                  aria-selected={index === activeIndex}
                  class={cn(
                    'type-caption flex min-h-(--control-height-compact) min-w-0 cursor-pointer items-center overflow-hidden rounded-(--radius-small) px-2 py-1 font-normal text-muted-foreground outline-none transition-colors duration-(--motion-fast)',
                    index === activeIndex && 'bg-muted text-foreground',
                  )}
                  onclick={() => void selectMessage(message.id)}
                  onkeydown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void selectMessage(message.id);
                    }
                  }}
                  onpointerenter={() => (activeIndex = index)}
                  title={message.text}
                  data-testid="chat-message-navigator-result"
                  data-message-id={message.id}
                >
                  <span class="block min-w-0 flex-1 truncate whitespace-nowrap font-normal">
                    {message.text}
                  </span>
                </button>
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
