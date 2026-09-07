<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
  import FileIcon from 'phosphor-svelte/lib/FileIcon';
  import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import SurfaceProvider from '$lib/components/ui/SurfaceProvider.svelte';
  import { useSize } from '$lib/components/ui/size-context';
  import { surfaceClasses } from '$lib/components/ui/surface-context';
  import { Textarea } from '$lib/components/ui/textarea';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { animatedHeight, scale } from '$lib/motion';
  import { cn } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';
  import QueuedRow from './queued-row.svelte';
  import SuggestionRow from './suggestion-row.svelte';
  import type { MessageComposerProps, QueuedMessage } from './types';

  const DEFAULT_ACCEPT = 'image/png,image/jpeg,application/pdf';
  // i18n-ignore (public API reference default; consumers can override)
  const DEFAULT_PLACEHOLDER = 'Ask me anything…';
  // i18n-ignore (public API reference default; consumers can override)
  const DEFAULT_SEND_LABEL = 'Send';
  // i18n-ignore (accessibility label from the reference contract)
  const MESSAGE_LABEL = 'Message';
  // i18n-ignore (HTML property name, not user-facing copy)
  const ARIA_LABEL = 'aria-label';
  // i18n-ignore (accessibility label from the reference contract)
  const SUGGESTIONS_LABEL = 'Suggested prompts';

  const uid = $props.id();
  const contextSize = useSize();
  let {
    size,
    value = $bindable(''),
    onValueChange,
    onSend,
    placeholder = DEFAULT_PLACEHOLDER,
    leftSlot,
    rightSlot,
    disabled = false,
    minRows = 1,
    maxRows = 8,
    clickToFocus = true,
    sendLabel = DEFAULT_SEND_LABEL,
    files,
    onFilesChange,
    accept = DEFAULT_ACCEPT,
    maxFiles,
    filePreviewSize = 80,
    textareaProps,
    status,
    onStop,
    queue,
    onQueueChange,
    showQueue = true,
    history = [],
    placeholderSuggestion,
    suggestions = [],
    class: className,
    style,
    ...restProps
  }: MessageComposerProps = $props();

  const resolvedSize = $derived(size ?? contextSize);
  const compact = $derived(resolvedSize === 'compact');
  const filesArr = $derived(files ?? []);
  const queueArr = $derived(queue ?? []);
  const supportsFiles = $derived(onFilesChange !== undefined);
  const supportsQueue = $derived(status !== undefined && onQueueChange !== undefined);
  const streaming = $derived(status === 'streaming');
  const trimmed = $derived(value.trim());
  const canSend = $derived(!disabled && (trimmed.length > 0 || filesArr.length > 0));
  const filesOpen = $derived(filesArr.length > 0);
  const queueOpen = $derived(supportsQueue && showQueue && queueArr.length > 0);
  const suggestionsOpen = $derived(suggestions.length > 0 && value === '');

  let rootRef: HTMLDivElement | null = $state(null);
  let textareaRef: HTMLTextAreaElement | null = $state(null);
  let fileInputRef: HTMLInputElement | null = $state(null);
  let suggestionListRef: HTMLDivElement | null = $state(null);
  let suggestionHover: ProximityHover | null = $state.raw(null);
  let fallbackSuggestion: number | null = $state(null);
  let focused = $state(false);
  let hovered = $state(false);
  let dragOver = $state(false);
  let historyIndex: number | null = $state(null);
  let draftBeforeHistory = '';
  let liveMessage = $state('');
  let currentQueue: QueuedMessage[] = [];
  let previousStatus: 'idle' | 'streaming' | undefined;
  let statusInitialized = false;

  const showGhost = $derived(Boolean(placeholderSuggestion) && value === '' && !dragOver);
  const activeSuggestion = $derived.by(() => {
    const hover = suggestionHover as ProximityHover | null;
    return hover ? hover.activeIndex : fallbackSuggestion;
  });
  const ringState = $derived(
    dragOver ? 'drag' : focused ? 'focus' : hovered && clickToFocus && !disabled ? 'hover' : 'rest',
  );
  const edgeShadow = $derived(
    ringState === 'drag'
      ? '0 0 0 1px hsl(var(--focus-ring)), var(--shadow-surface-2)'
      : ringState === 'focus'
        ? '0 0 0 1px hsl(var(--foreground) / 0.2), var(--shadow-surface-2)'
        : ringState === 'hover'
          ? '0 0 0 1px hsl(var(--border)), var(--shadow-surface-2)'
          : undefined,
  );
  const rootStyle = $derived(
    [edgeShadow ? `box-shadow:${edgeShadow}` : '', typeof style === 'string' ? style : '']
      .filter(Boolean)
      .join(';'),
  );
  const buttonMode = $derived<'send' | 'queue' | 'stop'>(
    !streaming ? 'send' : canSend && supportsQueue ? 'queue' : onStop ? 'stop' : 'send',
  );
  const buttonLabel = $derived(
    buttonMode === 'stop'
      ? m.chat_richInput_stop_label()
      : buttonMode === 'queue'
        ? m.chat_richInput_queueMessage_ariaLabel()
        : sendLabel,
  );
  const ghostHintId = `${uid}-suggestion-hint`;
  const suggestionListId = `${uid}-suggestions`;

  $effect(() => {
    currentQueue = queueArr;
  });

  $effect(() => {
    const nextStatus = status;
    if (!statusInitialized) {
      previousStatus = nextStatus;
      statusInitialized = true;
      return;
    }
    const wasStreaming = previousStatus === 'streaming';
    previousStatus = nextStatus;
    if (!supportsQueue || !wasStreaming || nextStatus !== 'idle' || queueArr.length === 0) return;
    const [next, ...rest] = queueArr;
    updateQueue(rest);
    onSend?.(next.text, next.files, { queuedId: next.id });
    // i18n-ignore (polite status mirrors the reference primitive contract)
    liveMessage = `Message sent.${rest.length ? ` ${rest.length} still queued.` : ''}`;
  });

  $effect(() => {
    value;
    minRows;
    maxRows;
    void tick().then(resizeTextarea);
  });

  $effect(() => {
    if (!suggestionListRef || !suggestionsOpen) {
      suggestionHover = null;
      return;
    }
    const hover = createProximityHover(suggestionListRef);
    suggestionHover = hover;
    return () => {
      hover.destroy();
      if (suggestionHover === hover) suggestionHover = null;
    };
  });

  onDestroy(() => suggestionHover?.destroy());

  function updateValue(next: string) {
    value = next;
    onValueChange?.(next);
  }

  function updateQueue(next: QueuedMessage[]) {
    currentQueue = next;
    onQueueChange?.(next);
  }

  function setActiveSuggestion(index: number | null) {
    fallbackSuggestion = index;
    suggestionHover?.setActiveIndex(index);
  }

  function resizeTextarea() {
    if (!textareaRef) return;
    textareaRef.style.height = 'auto';
    const parsed = Number.parseFloat(getComputedStyle(textareaRef).lineHeight);
    const lineHeight = Number.isFinite(parsed) ? parsed : 20;
    const min = lineHeight * Math.max(1, minRows);
    const max = lineHeight * Math.max(minRows, maxRows);
    textareaRef.style.height = `${Math.min(Math.max(textareaRef.scrollHeight, min), max)}px`;
    textareaRef.style.overflowY = textareaRef.scrollHeight > max ? 'auto' : 'hidden';
  }

  function focusTextarea() {
    void tick().then(() => {
      textareaRef?.focus();
      textareaRef?.setSelectionRange(value.length, value.length);
    });
  }

  function acceptSuggestion(text: string) {
    historyIndex = null;
    setActiveSuggestion(null);
    updateValue(text);
    focusTextarea();
  }

  function handleInput(event: Event) {
    historyIndex = null;
    setActiveSuggestion(null);
    onValueChange?.((event.currentTarget as HTMLTextAreaElement).value);
    resizeTextarea();
  }

  function handleSend() {
    if (!canSend) return;
    historyIndex = null;
    if (streaming && supportsQueue) {
      const item = { id: crypto.randomUUID(), text: trimmed, files: [...filesArr] };
      updateQueue([...currentQueue, item]);
      updateValue('');
      if (supportsFiles) onFilesChange?.([]);
      focusTextarea();
      return;
    }
    onSend?.(trimmed, filesArr);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (suggestionsOpen && plain) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestion(
          activeSuggestion === null ? 0 : Math.min(activeSuggestion + 1, suggestions.length - 1),
        );
        return;
      }
      if (activeSuggestion !== null && event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestion(activeSuggestion === 0 ? null : activeSuggestion - 1);
        return;
      }
      if (activeSuggestion !== null && event.key === 'Enter') {
        event.preventDefault();
        acceptSuggestion(suggestions[activeSuggestion]);
        return;
      }
      if (activeSuggestion !== null && event.key === 'Escape') {
        event.preventDefault();
        setActiveSuggestion(null);
        return;
      }
    }
    if (event.key === 'Tab' && !event.shiftKey && placeholderSuggestion && value === '') {
      event.preventDefault();
      acceptSuggestion(placeholderSuggestion);
      return;
    }
    if (history.length > 0 && plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const element = event.currentTarget as HTMLTextAreaElement;
      const caret = element.selectionStart ?? 0;
      const end = element.selectionEnd ?? caret;
      if (event.key === 'ArrowUp' && !value.slice(0, caret).includes('\n')) {
        const start = historyIndex === null ? history.length : historyIndex;
        if (start > 0) {
          event.preventDefault();
          if (historyIndex === null) draftBeforeHistory = value;
          historyIndex = start - 1;
          updateValue(history[historyIndex]);
          focusTextarea();
        }
        return;
      }
      if (event.key === 'ArrowDown' && historyIndex !== null && !value.slice(end).includes('\n')) {
        event.preventDefault();
        const next = historyIndex + 1;
        if (next >= history.length) {
          historyIndex = null;
          updateValue(draftBeforeHistory);
        } else {
          historyIndex = next;
          updateValue(history[next]);
        }
        focusTextarea();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleRootMousedown(event: MouseEvent) {
    if (!clickToFocus || disabled || event.target === textareaRef) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button,a,input,select,textarea,[contenteditable],[role="button"],[data-message-composer-queue]',
      )
    )
      return;
    event.preventDefault();
    textareaRef?.focus();
  }

  function matchesAccept(file: File) {
    return accept
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .some((token) =>
        token.endsWith('/*')
          ? file.type.startsWith(token.slice(0, -1))
          : token.startsWith('.')
            ? file.name.toLowerCase().endsWith(token.toLowerCase())
            : file.type === token,
      );
  }

  function addFiles(incoming: File[]) {
    if (!onFilesChange) return;
    const fingerprint = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
    const seen = new Set(filesArr.map(fingerprint));
    const accepted = incoming.filter((file) => {
      const key = fingerprint(file);
      if (!matchesAccept(file) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const next = [...filesArr, ...accepted];
    if (accepted.length) onFilesChange(maxFiles === undefined ? next : next.slice(0, maxFiles));
  }

  function openFilePicker(acceptOverride?: string) {
    if (!fileInputRef) return;
    if (acceptOverride) fileInputRef.accept = acceptOverride;
    fileInputRef.click();
    queueMicrotask(() => {
      if (fileInputRef) fileInputRef.accept = accept;
    });
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files) addFiles(Array.from(input.files));
    input.value = '';
  }

  function handleDragover(event: DragEvent) {
    if (
      !supportsFiles ||
      disabled ||
      !Array.from(event.dataTransfer?.types ?? []).includes('Files')
    )
      return;
    event.preventDefault();
    dragOver = true;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragleave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef?.contains(next)) return;
    dragOver = false;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    if (supportsFiles && !disabled) addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function editQueued(item: QueuedMessage) {
    updateValue(item.text);
    if (supportsFiles)
      onFilesChange?.(maxFiles === undefined ? item.files : item.files.slice(0, maxFiles));
    updateQueue(currentQueue.filter((queued) => queued.id !== item.id));
    focusTextarea();
  }

  function removeQueued(item: QueuedMessage) {
    updateQueue(currentQueue.filter((queued) => queued.id !== item.id));
  }

  function moveQueued(item: QueuedMessage, direction: -1 | 1) {
    const from = currentQueue.findIndex((queued) => queued.id === item.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= currentQueue.length) return;
    const next = [...currentQueue];
    [next[from], next[to]] = [next[to], next[from]];
    updateQueue(next);
  }

  function reorderQueued(sourceId: string, targetId: string) {
    const from = currentQueue.findIndex((item) => item.id === sourceId);
    const to = currentQueue.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...currentQueue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateQueue(next);
  }

  const slotContext = $derived({ openFilePicker, files: filesArr });
</script>

{#snippet composer()}
  <div
    bind:this={rootRef}
    data-slot="message-composer"
    data-ring-state={ringState}
    data-size={resolvedSize}
    class={cn(
      'flex flex-col rounded-(--radius-large) p-2 transition-[box-shadow,color] duration-spring-fast ease-spring-fast',
      surfaceClasses(2, 2),
      clickToFocus && !disabled && 'cursor-text',
      disabled && 'pointer-events-none opacity-50',
      className,
    )}
    style={rootStyle || undefined}
    onmousedown={handleRootMousedown}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    ondragover={handleDragover}
    ondragleave={handleDragleave}
    ondrop={handleDrop}
    {...restProps}
  >
    <SurfaceProvider value={2}>
      {#if supportsFiles}
        <Input
          type="file"
          bind:ref={fileInputRef}
          {accept}
          multiple={maxFiles === undefined || maxFiles > 1}
          class="hidden"
          tabindex={-1}
          aria-hidden="true"
          onchange={handleFileChange}
        />
      {/if}

      <div
        use:animatedHeight={{ open: filesOpen, tier: 'moderate' }}
        data-message-composer-height="files"
        data-motion-tier="moderate"
        aria-hidden={!filesOpen || undefined}
        inert={!filesOpen}
      >
        <div class="flex flex-wrap gap-2 pb-1" data-message-composer-files>
          {#each filesArr as file, index (`${file.name}-${file.size}-${file.lastModified}`)}
            <div
              class="group/file relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-(--radius-medium) bg-muted p-2 text-muted-foreground"
              style={`width:${filePreviewSize}px;height:${filePreviewSize}px`}
              in:scale={{ tier: 'fast' }}
              out:scale={{ tier: 'fast' }}
            >
              {#if file.type.startsWith('image/')}<ImageIcon
                  size={24}
                  aria-hidden="true"
                />{:else}<FileIcon size={24} aria-hidden="true" />{/if}
              <span class="mt-1 w-full truncate text-center text-[10px]">{file.name}</span>
              <Button
                variant="plain"
                size="icon-xs"
                iconOnly
                aria-label={m.chat_attachmentPreview_remove_ariaLabel({ name: file.name })}
                class="absolute right-1 top-1 size-5! rounded-full! bg-foreground! text-background! opacity-0 focus-visible:-outline-offset-1 group-hover/file:opacity-100 group-focus-within/file:opacity-100"
                onclick={(event) => {
                  event.stopPropagation();
                  onFilesChange?.(filesArr.filter((_, fileIndex) => fileIndex !== index));
                }}><XIcon size={12} weight="bold" aria-hidden="true" /></Button
              >
            </div>
          {/each}
        </div>
      </div>

      <div
        use:animatedHeight={{ open: queueOpen, tier: 'moderate' }}
        data-message-composer-height="queue"
        data-motion-tier="moderate"
        aria-hidden={!queueOpen || undefined}
        inert={!queueOpen}
      >
        <ul
          class="flex flex-col gap-1 pb-1"
          class:pt-1={filesOpen}
          data-message-composer-queue-list
        >
          {#each queueArr as item (item.id)}
            <QueuedRow
              {item}
              {compact}
              onEdit={editQueued}
              onRemove={removeQueued}
              onMove={moveQueued}
              onReorder={reorderQueued}
            />
          {/each}
        </ul>
      </div>

      <div class="relative" class:mt-1={filesOpen || queueOpen}>
        <Textarea
          {...textareaProps}
          bind:ref={textareaRef}
          bind:value
          rows={minRows}
          {disabled}
          placeholder={dragOver && supportsFiles
            ? m.chat_richInput_dropFiles_label()
            : placeholderSuggestion
              ? undefined
              : placeholder}
          aria-label={textareaProps?.[ARIA_LABEL] ?? MESSAGE_LABEL}
          aria-describedby={[
            showGhost ? ghostHintId : undefined,
            textareaProps?.['aria-describedby'],
          ]
            .filter(Boolean)
            .join(' ') || undefined}
          aria-controls={suggestionsOpen ? suggestionListId : undefined}
          aria-activedescendant={activeSuggestion === null
            ? undefined
            : `${suggestionListId}-${activeSuggestion}`}
          noFocusStyle
          class={cn(
            'min-h-0! resize-none border-0 bg-transparent px-2 py-2 shadow-none outline-none placeholder:text-muted-foreground',
            compact ? 'px-1.5 py-1.5 text-[13px] leading-[18px]' : 'text-sm leading-5',
            textareaProps?.class,
          )}
          oninput={handleInput}
          onkeydown={handleKeydown}
          onfocus={(event) => {
            focused = true;
            textareaProps?.onfocus?.(event);
          }}
          onblur={(event) => {
            focused = false;
            setActiveSuggestion(null);
            textareaProps?.onblur?.(event);
          }}
        />
        {#if showGhost}
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 overflow-hidden px-2 py-2 text-sm leading-5 text-muted-foreground"
            class:px-1.5={compact}
            class:py-1.5={compact}
            class:text-[13px]={compact}
            class:leading-[18px]={compact}
          >
            <span class="flex max-w-full items-center gap-1.5">
              <span class="min-w-0 truncate">{placeholderSuggestion}</span>
              <span
                class="inline-flex h-[18px] items-center rounded-[5px] border border-border bg-background px-1"
              >
                <!-- i18n-ignore (physical keyboard key label) -->
                <ShortcutChip>Tab</ShortcutChip>
              </span>
            </span>
          </div>
          <span id={ghostHintId} class="sr-only">
            <!-- i18n-ignore (accessibility hint mirrors the reference contract) -->
            Suggested prompt: {placeholderSuggestion}. Press Tab to fill the composer with it.
          </span>
        {/if}
      </div>

      <div class="mt-1 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          {#if leftSlot}{@render leftSlot(slotContext)}{/if}
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          {#if rightSlot}{@render rightSlot(slotContext)}{/if}
          <Button
            type="button"
            variant="primary"
            size={compact ? 'icon-compact' : 'icon-sm'}
            iconOnly
            aria-label={buttonLabel}
            data-mode={buttonMode}
            disabled={buttonMode === 'stop' ? disabled : !canSend}
            onclick={buttonMode === 'stop' ? () => onStop?.() : handleSend}
          >
            {#key buttonMode === 'stop'}
              <span
                in:scale={{ tier: 'fast' }}
                out:scale={{ tier: 'fast' }}
                class="flex items-center"
              >
                {#if buttonMode === 'stop'}
                  <span class="size-3 rounded-[3px] bg-current" aria-hidden="true"></span>
                {:else}
                  <ArrowUpIcon size={compact ? 15 : 19} weight="bold" aria-hidden="true" />
                {/if}
              </span>
            {/key}
          </Button>
        </div>
      </div>

      <div
        use:animatedHeight={{ open: suggestionsOpen, tier: 'moderate' }}
        data-message-composer-height="suggestions"
        data-motion-tier="moderate"
        aria-hidden={!suggestionsOpen || undefined}
        inert={!suggestionsOpen}
      >
        <div class="pt-2">
          <div
            bind:this={suggestionListRef}
            id={suggestionListId}
            role="listbox"
            aria-label={SUGGESTIONS_LABEL}
            class="relative -mx-2 flex flex-col border-t border-border px-1.5 pt-1.5"
          >
            {#if suggestionHover}<ProximityHighlight store={suggestionHover} />{/if}
            {#if suggestionHover}
              {#each suggestions as suggestion, index (`${suggestion}-${index}`)}
                <SuggestionRow
                  text={suggestion}
                  {index}
                  active={activeSuggestion === index}
                  keyHint={index === 0 && activeSuggestion === null}
                  optionId={`${suggestionListId}-${index}`}
                  hover={suggestionHover}
                  {compact}
                  onSelect={() => acceptSuggestion(suggestion)}
                />
              {/each}
            {/if}
          </div>
        </div>
      </div>
      <span class="sr-only" role="status" aria-live="polite">{liveMessage}</span>
    </SurfaceProvider>
  </div>
{/snippet}

{#if size}
  <SizeProvider {size}>{@render composer()}</SizeProvider>
{:else}
  {@render composer()}
{/if}
