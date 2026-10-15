// Source: src/lib/components/ui/message-composer/message-composer.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Rich listbox options keep keyboard focus in the textarea; native select cannot represent this interaction. */
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { ArrowUpIcon, FileIcon, ImageIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SizeProvider, useSize } from '@/components/ui/size-context';
import { SurfaceProvider } from '@/components/ui/surface-context';
import { Textarea } from '@/components/ui/textarea';
import { createProximityHover, useProximityHover, type ProximityHover } from '@/lib/interaction';
import { ProximityHighlight } from '@/lib/interaction/proximity-highlight';
import { scale, useAnimatedHeight, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
import QueuedRow from './queued-row';
import SuggestionRow from './suggestion-row';
import type { MessageComposerProps, QueuedMessage } from './types';

const DEFAULT_ACCEPT = 'image/png,image/jpeg,application/pdf';
const { formatNumber } = createFormatters(getLocale);
const NO_FILES: File[] = [];
const NO_QUEUE: QueuedMessage[] = [];
const NO_STRINGS: string[] = [];
const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
const fastScale = (node: HTMLElement) => scale(node, { tier: 'fast' }, { direction: 'both' });

function HeightRegion({
  name,
  open,
  children,
}: {
  name: string;
  open: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAnimatedHeight(ref, { open, tier: 'moderate' });
  return (
    <div
      ref={ref}
      data-message-composer-height={name}
      data-motion-tier="moderate"
      aria-hidden={!open || undefined}
      inert={!open}
    >
      {children}
    </div>
  );
}

function FileTile({
  file,
  size,
  present,
  onExit,
  onRemove,
}: {
  file: File;
  size: number;
  present: boolean;
  onExit: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, fastScale);
  return (
    <div
      ref={ref}
      className="group/file relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-(--radius-medium) bg-muted p-2 text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {file.type.startsWith('image/') ? (
        <ImageIcon size={24} aria-hidden="true" />
      ) : (
        <FileIcon size={24} aria-hidden="true" />
      )}
      <span className="mt-1 w-full truncate text-center text-xs">{file.name}</span>
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        aria-label={m.chat_attachmentPreview_remove_ariaLabel({ name: file.name })}
        className="absolute right-1 top-1 size-5! rounded-full! bg-foreground! text-background! opacity-0 focus-visible:-outline-offset-1 group-hover/file:opacity-100 group-focus-within/file:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <XIcon size={12} weight="regular" aria-hidden="true" />
      </Button>
    </div>
  );
}

function SendIcon({
  stop,
  compact,
  present,
  onExit,
}: {
  stop: boolean;
  compact: boolean;
  present: boolean;
  onExit: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  usePresenceTransition(ref, present, onExit, fastScale);
  return (
    <span ref={ref} className="flex items-center">
      {stop ? (
        <span className="size-3 rounded-[3px] bg-current" aria-hidden="true" />
      ) : (
        <ArrowUpIcon size={compact ? 15 : 19} weight="regular" aria-hidden="true" />
      )}
    </span>
  );
}

export function MessageComposer({
  size,
  value: valueProp = '',
  onValueChange,
  onSend,
  placeholder = m.ui_messageComposer_placeholder(),
  leftSlot,
  rightSlot,
  disabled = false,
  minRows = 1,
  maxRows = 8,
  clickToFocus = true,
  sendLabel = m.chat_richInput_send_label(),
  files = NO_FILES,
  hasAttachments = false,
  sendDisabled = false,
  onFilesChange,
  accept = DEFAULT_ACCEPT,
  maxFiles,
  filePreviewSize = 80,
  textareaProps,
  status,
  onStop,
  onEnqueue,
  enqueueDisabled = false,
  queue = NO_QUEUE,
  onQueueChange,
  showQueue = true,
  history = NO_STRINGS,
  placeholderSuggestion,
  suggestions = NO_STRINGS,
  className,
  style,
  ref,
  ...restProps
}: MessageComposerProps) {
  const uid = useId();
  const contextSize = useSize();
  const resolvedSize = size ?? contextSize;
  const compact = resolvedSize === 'compact';
  // Svelte's bindable value also works without a binding. Keep that local-draft
  // behavior while synchronizing explicit value changes from the consumer.
  const [draft, setDraft] = useState({ prop: valueProp, value: valueProp });
  let value = draft.value;
  if (draft.prop !== valueProp) {
    value = valueProp;
    setDraft({ prop: valueProp, value: valueProp });
  }
  const currentValue = useRef(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const [suggestionHover, setSuggestionHover] = useState<ProximityHover | null>(null);
  useProximityHover(suggestionHover);
  const [fallbackSuggestion, setFallbackSuggestion] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const historyIndex = useRef<number | null>(null);
  const draftBeforeHistory = useRef('');
  const [liveMessage, setLiveMessage] = useState('');
  const currentQueue = useRef(queue);
  const previousStatus = useRef(status);
  const supportsFiles = onFilesChange !== undefined;
  const supportsQueue = status !== undefined && onQueueChange !== undefined && onEnqueue === undefined;
  const streaming = status === 'streaming';
  const canSend =
    !disabled && !sendDisabled && (value.trim().length > 0 || files.length > 0 || hasAttachments);
  const filesOpen = files.length > 0;
  const queueOpen = supportsQueue && showQueue && queue.length > 0;
  const suggestionsOpen = suggestions.length > 0 && value === '';
  const showGhost = Boolean(placeholderSuggestion) && value === '' && !dragOver;
  const activeSuggestion = suggestionHover ? suggestionHover.activeIndex : fallbackSuggestion;
  const ringState = dragOver
    ? 'drag'
    : focused
      ? 'focus'
      : hovered && clickToFocus && !disabled
        ? 'hover'
        : 'rest';
  const buttonMode = !streaming
    ? 'send'
    : canSend && (supportsQueue || (!!onEnqueue && !enqueueDisabled))
      ? 'queue'
      : onStop
        ? 'stop'
        : 'send';
  const buttonLabel =
    buttonMode === 'stop'
      ? m.chat_richInput_stop_label()
      : buttonMode === 'queue'
        ? m.chat_richInput_queueMessage_ariaLabel()
        : sendLabel;
  const ghostHintId = `${uid}-suggestion-hint`;
  const suggestionListId = `${uid}-suggestions`;
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const filePresence = usePresence(files, fileKey);
  const stop = buttonMode === 'stop';
  const iconItems = useMemo(() => [stop], [stop]);
  const iconPresence = usePresence(iconItems, (isStop) => String(isStop));

  useLayoutEffect(() => {
    currentValue.current = value;
  }, [value]);
  useLayoutEffect(() => {
    currentQueue.current = queue;
  }, [queue]);
  useLayoutEffect(() => {
    const wasStreaming = previousStatus.current === 'streaming';
    previousStatus.current = status;
    if (!supportsQueue || !wasStreaming || status !== 'idle' || currentQueue.current.length === 0)
      return;
    const [next, ...rest] = currentQueue.current;
    currentQueue.current = rest;
    onQueueChange?.(rest);
    onSend?.(next.text, next.files, { queuedId: next.id });
    setLiveMessage(
      rest.length
        ? m.ui_messageComposer_sentQueued_label({ count: formatNumber(rest.length) })
        : m.ui_messageComposer_sent_label(),
    );
  }, [status, supportsQueue, onQueueChange, onSend]);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const parsed = Number.parseFloat(getComputedStyle(node).lineHeight);
    const lineHeight = Number.isFinite(parsed) ? parsed : 20;
    const min = lineHeight * Math.max(1, minRows);
    const max = lineHeight * Math.max(minRows, maxRows);
    node.style.height = `${Math.min(Math.max(node.scrollHeight, min), max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);

  useLayoutEffect(() => {
    if (!suggestionsOpen || !suggestionListRef.current) {
      setSuggestionHover(null);
      return;
    }
    const hover = createProximityHover(suggestionListRef.current);
    setSuggestionHover(hover);
    return () => hover.destroy();
  }, [suggestionsOpen]);

  function updateValue(next: string) {
    currentValue.current = next;
    setDraft({ prop: valueProp, value: next });
    onValueChange?.(next);
  }

  function updateQueue(next: QueuedMessage[]) {
    currentQueue.current = next;
    onQueueChange?.(next);
  }

  function setActiveSuggestion(index: number | null) {
    setFallbackSuggestion(index);
    suggestionHover?.setActiveIndex(index);
  }

  function focusTextarea() {
    queueMicrotask(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(currentValue.current.length, currentValue.current.length);
    });
  }

  function acceptSuggestion(text: string) {
    historyIndex.current = null;
    setActiveSuggestion(null);
    updateValue(text);
    focusTextarea();
  }

  function handleSend() {
    const trimmed = currentValue.current.trim();
    if (disabled || sendDisabled || (!trimmed && files.length === 0 && !hasAttachments)) return;
    historyIndex.current = null;
    if (streaming && onEnqueue) {
      if (!enqueueDisabled) onEnqueue(trimmed);
      return;
    }
    if (streaming && supportsQueue) {
      const item = { id: crypto.randomUUID(), text: trimmed, files: [...files] };
      updateQueue([...currentQueue.current, item]);
      updateValue('');
      if (supportsFiles) onFilesChange?.([]);
      focusTextarea();
      return;
    }
    onSend?.(trimmed, files);
  }

  function handleSuggestionShortcut(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      disabled ||
      suggestions.length === 0 ||
      currentValue.current !== '' ||
      !rootRef.current?.contains(document.activeElement) ||
      event.shiftKey ||
      event.metaKey
    )
      return;
    const modifier = isMac ? event.ctrlKey && !event.altKey : event.altKey && !event.ctrlKey;
    if (!modifier || !/^[1-3]$/.test(event.key)) return;
    const suggestion = suggestions[Number(event.key) - 1];
    if (suggestion === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    acceptSuggestion(suggestion);
  }

  function handleKeydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const current = currentValue.current;
    const active = suggestionHover ? suggestionHover.activeIndex : fallbackSuggestion;
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    if (suggestions.length > 0 && current === '' && plain) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestion(active === null ? 0 : Math.min(active + 1, suggestions.length - 1));
        return;
      }
      if (active !== null && event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestion(active === 0 ? null : active - 1);
        return;
      }
      if (active !== null && event.key === 'Enter') {
        event.preventDefault();
        acceptSuggestion(suggestions[active]);
        return;
      }
      if (active !== null && event.key === 'Escape') {
        event.preventDefault();
        setActiveSuggestion(null);
        return;
      }
    }
    if (event.key === 'Tab' && !event.shiftKey && placeholderSuggestion && current === '') {
      event.preventDefault();
      acceptSuggestion(placeholderSuggestion);
      return;
    }
    if (history.length > 0 && plain && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const element = event.currentTarget;
      const caret = element.selectionStart ?? 0;
      const end = element.selectionEnd ?? caret;
      if (event.key === 'ArrowUp' && !current.slice(0, caret).includes('\n')) {
        const start = historyIndex.current === null ? history.length : historyIndex.current;
        if (start > 0) {
          event.preventDefault();
          if (historyIndex.current === null) draftBeforeHistory.current = current;
          historyIndex.current = start - 1;
          updateValue(history[historyIndex.current]);
          focusTextarea();
        }
        return;
      }
      if (
        event.key === 'ArrowDown' &&
        historyIndex.current !== null &&
        !current.slice(end).includes('\n')
      ) {
        event.preventDefault();
        const next = historyIndex.current + 1;
        if (next >= history.length) {
          historyIndex.current = null;
          updateValue(draftBeforeHistory.current);
        } else {
          historyIndex.current = next;
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

  function handleRootMousedown(event: MouseEvent<HTMLDivElement>) {
    if (!clickToFocus || disabled || event.target === textareaRef.current) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button,a,input,select,textarea,[contenteditable],[role="button"],[data-message-composer-queue]',
      )
    )
      return;
    event.preventDefault();
    textareaRef.current?.focus();
  }

  function matchesAccept(file: File) {
    if (!accept.trim()) return true;
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
    const seen = new Set(files.map(fileKey));
    const accepted = incoming.filter((file) => {
      const key = fileKey(file);
      if (!matchesAccept(file) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const next = [...files, ...accepted];
    if (accepted.length) onFilesChange(maxFiles === undefined ? next : next.slice(0, maxFiles));
  }

  function openFilePicker(acceptOverride?: string) {
    if (!fileInputRef.current) return;
    if (acceptOverride) fileInputRef.current.accept = acceptOverride;
    fileInputRef.current.click();
    queueMicrotask(() => {
      if (fileInputRef.current) fileInputRef.current.accept = accept;
    });
  }

  function handleDragover(event: DragEvent<HTMLDivElement>) {
    if (!supportsFiles || disabled || !Array.from(event.dataTransfer.types).includes('Files'))
      return;
    event.preventDefault();
    setDragOver(true);
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragleave(event: DragEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    setDragOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (supportsFiles && !disabled) addFiles(Array.from(event.dataTransfer.files));
  }

  function editQueued(item: QueuedMessage) {
    updateValue(item.text);
    if (supportsFiles)
      onFilesChange?.(maxFiles === undefined ? item.files : item.files.slice(0, maxFiles));
    updateQueue(currentQueue.current.filter((queued) => queued.id !== item.id));
    focusTextarea();
  }

  function removeQueued(item: QueuedMessage) {
    updateQueue(currentQueue.current.filter((queued) => queued.id !== item.id));
  }

  function moveQueued(item: QueuedMessage, direction: -1 | 1) {
    const from = currentQueue.current.findIndex((queued) => queued.id === item.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= currentQueue.current.length) return;
    const next = [...currentQueue.current];
    [next[from], next[to]] = [next[to], next[from]];
    updateQueue(next);
  }

  function reorderQueued(sourceId: string, targetId: string) {
    const from = currentQueue.current.findIndex((item) => item.id === sourceId);
    const to = currentQueue.current.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...currentQueue.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateQueue(next);
  }

  const slotContext = { openFilePicker, files };
  const composer = (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Container delegates focus/shortcuts to the textarea and accepts native file drops, matching the source.
    <div
      ref={(node) => {
        rootRef.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="message-composer"
      data-ring-state={ringState}
      data-size={resolvedSize}
      className={cn(
        'flex flex-col rounded-(--radius-large) border border-border bg-surface-2 shadow-none p-2 transition-[box-shadow,color] duration-spring-fast ease-spring-fast',
        clickToFocus && !disabled && 'cursor-text',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      style={{ boxShadow: 'none', ...style }}
      onKeyDown={handleSuggestionShortcut}
      onMouseDown={handleRootMousedown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={handleDragover}
      onDragLeave={handleDragleave}
      onDrop={handleDrop}
      {...restProps}
    >
      <SurfaceProvider level={2}>
        <HeightRegion name="suggestions" open={suggestionsOpen}>
          <div className="pb-2">
            <div
              ref={suggestionListRef}
              id={suggestionListId}
              role="listbox"
              aria-label={m.ui_messageComposer_suggestions_ariaLabel()}
              className="relative -mx-2 flex flex-col border-b border-border px-1.5 pb-1.5"
            >
              {suggestionHover && <ProximityHighlight store={suggestionHover} />}
              {suggestionHover &&
                suggestions.map((suggestion, index) => (
                  <SuggestionRow
                    key={`${suggestion}-${index}`}
                    text={suggestion}
                    index={index}
                    shortcut={index < 3 ? `${isMac ? '⌃' : 'Alt+'}${index + 1}` : undefined}
                    active={activeSuggestion === index}
                    keyHint={index === 0 && activeSuggestion === null}
                    optionId={`${suggestionListId}-${index}`}
                    hover={suggestionHover}
                    compact={compact}
                    onSelect={() => acceptSuggestion(suggestion)}
                  />
                ))}
            </div>
          </div>
        </HeightRegion>

        {supportsFiles && (
          <Input
            type="file"
            ref={fileInputRef}
            accept={accept}
            multiple={maxFiles === undefined || maxFiles > 1}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const input = event.currentTarget;
              if (input.files) addFiles(Array.from(input.files));
              input.value = '';
            }}
          />
        )}

        <HeightRegion name="files" open={filesOpen}>
          <div className="flex flex-wrap gap-2 pb-1" data-message-composer-files="">
            {filePresence.entries.map(({ key, value: file, present }) => (
              <FileTile
                key={key}
                file={file}
                size={filePreviewSize}
                present={present}
                onExit={() => filePresence.remove(key)}
                onRemove={() => onFilesChange?.(files.filter((entry) => fileKey(entry) !== key))}
              />
            ))}
          </div>
        </HeightRegion>

        <HeightRegion name="queue" open={queueOpen}>
          <ul
            className={cn('flex flex-col gap-1 pb-1', filesOpen && 'pt-1')}
            data-message-composer-queue-list=""
          >
            {queue.map((item) => (
              <QueuedRow
                key={item.id}
                item={item}
                compact={compact}
                onEdit={editQueued}
                onRemove={removeQueued}
                onMove={moveQueued}
                onReorder={reorderQueued}
              />
            ))}
          </ul>
        </HeightRegion>

        <div className={cn('relative', (filesOpen || queueOpen) && 'mt-1')}>
          <Textarea
            {...textareaProps}
            ref={textareaRef}
            value={value}
            rows={minRows}
            disabled={disabled}
            placeholder={
              dragOver && supportsFiles
                ? m.chat_richInput_dropFiles_label()
                : placeholderSuggestion
                  ? undefined
                  : placeholder
            }
            aria-label={textareaProps?.['aria-label'] ?? m.chat_richInput_editor_ariaLabel()}
            aria-describedby={
              [showGhost ? ghostHintId : undefined, textareaProps?.['aria-describedby']]
                .filter(Boolean)
                .join(' ') || undefined
            }
            aria-controls={suggestionsOpen ? suggestionListId : undefined}
            aria-activedescendant={
              activeSuggestion === null ? undefined : `${suggestionListId}-${activeSuggestion}`
            }
            className={cn(
              'min-h-0! resize-none border-0 bg-transparent hover:bg-transparent focus:bg-transparent focus-visible:bg-transparent active:bg-transparent px-2 py-2 shadow-none placeholder:text-muted-foreground',
              compact ? 'px-1.5 py-1.5 text-[13px] leading-[18px]' : 'text-sm leading-5',
              textareaProps?.className,
            )}
            onChange={(event) => {
              historyIndex.current = null;
              setActiveSuggestion(null);
              updateValue(event.currentTarget.value);
            }}
            onKeyDown={handleKeydown}
            onFocus={(event) => {
              setFocused(true);
              textareaProps?.onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              setActiveSuggestion(null);
              textareaProps?.onBlur?.(event);
            }}
          />
          {showGhost && (
            <>
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-0 overflow-hidden px-2 py-2 text-sm leading-5 text-muted-foreground',
                  compact && 'px-1.5 py-1.5 text-[13px] leading-[18px]',
                )}
              >
                <span className="flex max-w-full items-center gap-1.5">
                  <span className="min-w-0 truncate">{placeholderSuggestion}</span>
                </span>
              </div>
              <span id={ghostHintId} className="sr-only">
                {m.ui_messageComposer_suggestionHint_description({
                  suggestion: placeholderSuggestion ?? '',
                })}
              </span>
            </>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* oxlint-disable-next-line react/refs -- Slot receives an event callback; only invoking openFilePicker later accesses the input ref. */}
            {leftSlot?.(slotContext)}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* oxlint-disable-next-line react/refs -- Slot receives an event callback; no ref value is read during render. */}
            {rightSlot?.(slotContext)}
            <Button
              type="button"
              variant="primary"
              size={compact ? 'icon-compact' : 'icon-sm'}
              iconOnly
              aria-label={buttonLabel}
              data-mode={buttonMode}
              disabled={buttonMode === 'stop' ? disabled : !canSend}
              onClick={buttonMode === 'stop' ? () => onStop?.() : handleSend}
            >
              {iconPresence.entries.map(({ key, value: isStop, present }) => (
                <SendIcon
                  key={key}
                  stop={isStop}
                  compact={compact}
                  present={present}
                  onExit={() => iconPresence.remove(key)}
                />
              ))}
            </Button>
          </div>
        </div>

        <output className="sr-only" aria-live="polite">
          {liveMessage}
        </output>
      </SurfaceProvider>
    </div>
  );
  return <SizeProvider size={resolvedSize}>{composer}</SizeProvider>;
}
