/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source focus surfaces and rich option groups without native fieldset layout. */
// The keyed question body from ask-user-questions.svelte, including row and input ownership.
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { clampSurface } from '@/components/ui/surface-context';
import { ProximityHighlight } from '@/lib/interaction/proximity-highlight';
import {
  createProximityHover,
  useProximityHover,
  type ProximityHover,
} from '@/lib/interaction/proximity-hover';
import { usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
import { QuestionAction, QuestionError, stepTransition } from './question-motion';
import type { AskUserAnswer, AskUserQuestion, AskUserQuestionsProps } from './types';

type Answers = Record<string, AskUserAnswer>;
export interface QuestionStepHandle {
  restoreFirstRow: () => void;
  handleDocumentKeydown: (event: KeyboardEvent) => void;
  handleRootKeydown: (event: KeyboardEvent) => void;
}
export interface QuestionStepProps extends Pick<
  AskUserQuestionsProps,
  | 'onSkip'
  | 'skipLabel'
  | 'showBack'
  | 'backLabel'
  | 'headerActions'
  | 'footerActions'
  | 'onOtherPaste'
  | 'otherAttachments'
  | 'centered'
  | 'showCounter'
  | 'alwaysShowSkip'
  | 'showOtherSubmit'
  | 'exclusiveOther'
  | 'clearOnSkip'
  | 'globalKeyboardShortcuts'
  | 'disabled'
> {
  question: AskUserQuestion;
  questionId: string;
  safeIndex: number;
  questionCount: number;
  compact: boolean;
  surface: number;
  uid: string;
  currentAnswer?: AskUserAnswer;
  latestAnswers: RefObject<Answers>;
  writeAnswers: (update: (previous: Answers) => Answers) => Answers;
  goNext: (snapshot: Answers) => void;
  back: () => void;
  registerStepHandle: (handle: QuestionStepHandle) => () => void;
  present: boolean;
  onExit: () => void;
}

const { formatInteger } = createFormatters(getLocale);

function ArrowLeft() {
  return (
    <svg className="hidden size-3.5 sm:block" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6.5 3.5 4.5 4.5-4.5 4.5M3 8h8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SkipArrow() {
  return (
    <svg
      className="size-3.5 text-muted-foreground"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 5v3a3 3 0 0 0 3 3h6m-3-3 3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const subscribePlatform = () => () => {};
const readPlatform = () => /mac/i.test(navigator.platform);
const serverPlatform = () => false;
const noOptions: NonNullable<AskUserQuestion['options']> = [];
const noSelection: string[] = [];

function Shortcut() {
  // Match the server's initial label, then adopt the real client platform after hydration.
  const isMac = useSyncExternalStore(subscribePlatform, readPlatform, serverPlatform);
  return (
    <kbd
      aria-hidden="true"
      className="hidden h-[18px] min-w-[18px] items-center justify-center rounded-(--radius-small) bg-primary-ink/15 px-1 font-sans text-xs leading-none tracking-wide text-primary-ink sm:inline-flex"
    >
      {isMac ? '⌘' : '⌃'}↵
    </kbd>
  );
}

export function QuestionStep({
  question,
  questionId,
  safeIndex,
  questionCount,
  compact,
  surface,
  uid,
  currentAnswer,
  latestAnswers,
  writeAnswers,
  goNext,
  back,
  registerStepHandle,
  present,
  onExit,
  onSkip,
  skipLabel = m.chat_questionWizard_skip_label(),
  showBack = false,
  backLabel = m.chat_questionWizard_back_label(),
  headerActions,
  footerActions,
  onOtherPaste,
  otherAttachments,
  centered = false,
  showCounter = true,
  alwaysShowSkip = false,
  showOtherSubmit = false,
  exclusiveOther = false,
  clearOnSkip = false,
  globalKeyboardShortcuts = false,
  disabled = false,
}: QuestionStepProps) {
  const element = useRef<HTMLDivElement>(null);
  const rowsElement = useRef<HTMLDivElement>(null);
  const otherInput = useRef<HTMLTextAreaElement>(null);
  const pendingRows = useRef(new Map<number, HTMLElement>());
  const hoverRef = useRef<ProximityHover | null>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  useProximityHover(hover);
  const [freeTextError, setFreeTextError] = useState<string | null>(null);
  const titleId = `${uid}-${questionId}-title`;
  const errorId = `${uid}-${questionId}-error`;
  const selectedIds = currentAnswer?.selectedIds ?? noSelection;
  const otherText = currentAnswer?.otherText ?? '';
  const hasOtherAnswer = otherText.trim().length > 0 || currentAnswer?.hasAttachments;
  const options = question.options ?? noOptions;
  const isMulti = Boolean(question.multiSelect);
  const isFreeText = Boolean(question.freeText);
  const multiline = question.freeTextMultiline !== false;
  const allowOther = !isFreeText && Boolean(question.allowOther);
  const otherIndex = allowOther ? options.length : -1;
  const rowCount = options.length + (allowOther ? 1 : 0);
  const firstSelectedIndex = options.findIndex((option, index) =>
    selectedIds.includes(option.id ?? `o-${index}`),
  );
  const selectedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    options.forEach((option, index) => {
      if (selectedIds.includes(option.id ?? `o-${index}`)) indexes.add(index);
    });
    return indexes;
  }, [options, selectedIds]);
  const canSubmit =
    !disabled &&
    (isFreeText ? otherText.trim().length > 0 : selectedIds.length > 0 || hasOtherAnswer);
  const optionsLocked =
    disabled ||
    Boolean(exclusiveOther && !isMulti && (otherText.length > 0 || currentAnswer?.hasAttachments));
  const showSkip = (alwaysShowSkip || questionCount > 1) && question.skippable !== false;
  const showSubmit =
    isMulti || isFreeText || Boolean(showOtherSubmit && allowOther && hasOtherAnswer);
  const showBackAction = showBack && safeIndex > 0;
  const showFooter =
    Boolean(footerActions) || showBackAction || showSkip || showSubmit || Boolean(freeTextError);
  usePresenceTransition(element, present, onExit, stepTransition);

  useLayoutEffect(() => {
    if (!rowsElement.current) return;
    const controller = createProximityHover(rowsElement.current);
    hoverRef.current = controller;
    pendingRows.current.forEach((node, index) => controller.registerItem(index, node));
    setHover(controller);
    return () => {
      controller.destroy();
      if (hoverRef.current === controller) hoverRef.current = null;
    };
  }, [isFreeText]);

  const fittedHeight = useRef(0);
  const manuallyResized = useRef(false);
  const maxLines = question.otherAutoGrowMaxLines;
  const fitOtherInput = useCallback(() => {
    const node = otherInput.current;
    if (!node || manuallyResized.current) return;
    node.style.height = 'auto';
    if (node.scrollHeight === 0) return;
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    const cap = maxLines && Number.isFinite(lineHeight) ? lineHeight * maxLines : Infinity;
    node.style.height = `${Math.min(node.scrollHeight, cap)}px`;
    fittedHeight.current = node.offsetHeight;
    hoverRef.current?.measure();
  }, [maxLines]);
  useLayoutEffect(() => {
    const node = otherInput.current;
    if (!node) return;
    manuallyResized.current = false;
    fitOtherInput();
    if (!maxLines || typeof ResizeObserver === 'undefined') return;
    let lastWidth = node.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(node.offsetHeight - fittedHeight.current) > 1) {
        manuallyResized.current = true;
        return;
      }
      if (node.offsetWidth !== lastWidth) {
        lastWidth = node.offsetWidth;
        fitOtherInput();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [maxLines, fitOtherInput, isFreeText, allowOther]);
  useLayoutEffect(fitOtherInput, [fitOtherInput, otherText]);
  useLayoutEffect(() => {
    if (present && isFreeText) otherInput.current?.focus({ preventScroll: true });
  }, [present, isFreeText]);

  function selectSingle(id: string) {
    if (optionsLocked || !present) return;
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: [id],
        otherText: previous[questionId]?.otherText || undefined,
        hasAttachments: previous[questionId]?.hasAttachments,
        skipped: false,
      },
    }));
    goNext(snapshot);
  }
  function toggleMulti(id: string) {
    if (disabled || !present) return;
    writeAnswers((previous) => {
      const existing = previous[questionId];
      const nextSelected = new Set(existing?.selectedIds ?? []);
      if (nextSelected.has(id)) nextSelected.delete(id);
      else nextSelected.add(id);
      return {
        ...previous,
        [questionId]: {
          questionId,
          selectedIds: [...nextSelected],
          otherText: existing?.otherText,
          hasAttachments: existing?.hasAttachments,
          skipped: false,
        },
      };
    });
  }
  function updateOther(text: string) {
    if (disabled || !present) return;
    setFreeTextError(null);
    writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds:
          exclusiveOther && !isMulti && text.length > 0
            ? []
            : (previous[questionId]?.selectedIds ?? []),
        otherText: text,
        hasAttachments: previous[questionId]?.hasAttachments,
        skipped: false,
      },
    }));
  }
  function submitOther() {
    if (disabled || !present) return;
    const text = (latestAnswers.current[questionId]?.otherText ?? '').trim();
    if (!text && (isFreeText || !latestAnswers.current[questionId]?.hasAttachments)) return;
    if (isFreeText && question.freeTextValidate) {
      const message = question.freeTextValidate(text);
      if (message) {
        setFreeTextError(message);
        return;
      }
    }
    setFreeTextError(null);
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: previous[questionId]?.selectedIds ?? [],
        otherText: text,
        hasAttachments: previous[questionId]?.hasAttachments,
        skipped: false,
      },
    }));
    goNext(snapshot);
  }
  function skip() {
    if (disabled || !present) return;
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: clearOnSkip ? [] : (previous[questionId]?.selectedIds ?? []),
        otherText: clearOnSkip ? undefined : previous[questionId]?.otherText,
        hasAttachments: clearOnSkip ? undefined : previous[questionId]?.hasAttachments,
        skipped: true,
      },
    }));
    onSkip?.(questionId, safeIndex);
    goNext(snapshot);
  }
  function finishMulti() {
    if (!canSubmit || !present) return;
    if (!isMulti && allowOther) submitOther();
    else goNext(latestAnswers.current);
  }
  function handleDocumentKeydown(event: KeyboardEvent) {
    if (disabled || !present || event.isComposing || event.defaultPrevented) return;
    if (
      globalKeyboardShortcuts &&
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      canSubmit
    ) {
      event.preventDefault();
      if (isFreeText) submitOther();
      else finishMulti();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable))
      return;
    if (event.key < '1' || event.key > '9') return;
    const optionIndex = Number.parseInt(event.key, 10) - 1;
    if (optionIndex < options.length) {
      event.preventDefault();
      const id = options[optionIndex].id ?? `o-${optionIndex}`;
      if (isMulti) toggleMulti(id);
      else if (!optionsLocked) selectSingle(id);
    } else if (allowOther && optionIndex === options.length) {
      event.preventDefault();
      otherInput.current?.focus();
    }
  }
  function handleRootKeydown(event: KeyboardEvent) {
    if (
      event.isComposing ||
      event.defaultPrevented ||
      event.key !== 'Enter' ||
      (!event.metaKey && !event.ctrlKey)
    )
      return;
    if (!isMulti && !isFreeText) return;
    event.preventDefault();
    if (isFreeText) submitOther();
    else finishMulti();
  }
  useLayoutEffect(() => {
    if (!present) return;
    const handle = {
      handleDocumentKeydown,
      handleRootKeydown,
      restoreFirstRow() {
        const firstRow = pendingRows.current.get(0);
        if (firstRow?.getAttribute('aria-disabled') !== 'true') firstRow?.focus();
      },
    };
    return registerStepHandle(handle);
  });

  function focusRow(rowIndex: number) {
    if (allowOther && rowIndex === otherIndex) otherInput.current?.focus();
    else pendingRows.current.get(rowIndex)?.focus();
    hoverRef.current?.setActiveIndex(rowIndex);
  }
  function handleRowsKeydown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.defaultPrevented || disabled || !present) return;
    const target = event.target as HTMLElement;
    const isTextInput = target.tagName === 'TEXTAREA';
    if (isTextInput && !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (
      isTextInput &&
      event.key === 'ArrowUp' &&
      (target as HTMLTextAreaElement).selectionStart > 0
    )
      return;
    if (
      isTextInput &&
      event.key === 'ArrowDown' &&
      (target as HTMLTextAreaElement).selectionEnd < (target as HTMLTextAreaElement).value.length
    )
      return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowLeft' && showBackAction) back();
      else if (event.key === 'ArrowRight' && showSkip) skip();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || rowCount === 0) return;
    event.preventDefault();
    event.stopPropagation();
    let next = 0;
    if (event.key === 'End') next = rowCount - 1;
    else if (event.key !== 'Home') {
      const base = isTextInput ? otherIndex : (hoverRef.current?.activeIndex ?? -1);
      next = (base + (event.key === 'ArrowDown' ? 1 : -1) + rowCount) % rowCount;
    }
    focusRow(next);
  }

  const rowRefs = useMemo(
    () =>
      Array.from({ length: rowCount }, (_, index) => (node: HTMLDivElement | null) => {
        if (node) pendingRows.current.set(index, node);
        else pendingRows.current.delete(index);
        hoverRef.current?.registerItem(index, node);
      }),
    [rowCount],
  );
  return (
    <div
      ref={element}
      data-animated-height-target={present ? '' : undefined}
      inert={!present}
      aria-hidden={!present || undefined}
      className={cn(
        'col-start-1 row-start-1 flex flex-col gap-2 px-5',
        !showCounter && (compact ? 'pt-2.5' : 'pt-3.5'),
        showFooter ? 'pb-1' : compact ? 'pb-2 sm:pb-2.5' : 'pb-2.5 sm:pb-3',
      )}
    >
      <div
        data-slot="ask-user-questions-header"
        className={cn(
          'flex min-w-0 gap-x-2 gap-y-1',
          centered ? 'flex-col items-center text-center' : 'flex-wrap items-start',
        )}
      >
        {question.header ? (
          <p
            className={cn(
              'min-w-0 break-words type-caption text-muted-foreground',
              centered ? 'w-full' : 'grow basis-48',
            )}
          >
            {question.header}
          </p>
        ) : (
          <h3
            id={titleId}
            className={cn(
              'min-w-0 break-words text-[16px] font-semibold leading-snug text-foreground',
              centered ? 'w-full' : 'grow basis-48',
            )}
          >
            {question.title}
          </h3>
        )}
        {headerActions && (
          <span
            className={cn(
              'flex max-w-full shrink-0 flex-wrap items-center gap-1',
              centered ? 'justify-center' : 'ml-auto justify-end',
            )}
          >
            {headerActions}
          </span>
        )}
      </div>
      {question.header && (
        <h3
          id={titleId}
          className={cn(
            'break-words text-[16px] font-semibold leading-snug text-foreground',
            centered && 'text-center',
          )}
        >
          {question.title}
        </h3>
      )}
      {question.description && (
        <p
          className={cn(
            'break-words text-xs leading-snug text-muted-foreground',
            centered && 'text-center',
          )}
        >
          {question.description}
        </p>
      )}
      {isFreeText ? (
        <div
          role="group"
          aria-labelledby={titleId}
          style={
            { '--color-card': `hsl(var(--surface-${clampSurface(surface + 1)}))` } as CSSProperties
          }
          className={cn(
            'relative mt-1 cursor-text rounded-(--radius-small) hover:bg-hover focus-within:bg-card! focus-within:ring-1 focus-within:ring-inset focus-within:ring-border transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            compact ? '-mx-2.5 px-2.5 py-2' : '-mx-3 px-3 py-2.5',
            multiline ? 'min-h-[76px]' : compact ? 'min-h-8' : 'min-h-10',
          )}
          onPointerDown={(event) => {
            if (!disabled && event.target !== otherInput.current) otherInput.current?.focus();
          }}
        >
          <Textarea
            ref={otherInput}
            rows={1}
            value={otherText}
            placeholder={
              question.freeTextPlaceholder ?? m.ui_askUserQuestions_freeText_placeholder()
            }
            aria-labelledby={titleId}
            aria-describedby={freeTextError ? errorId : undefined}
            aria-invalid={freeTextError ? 'true' : undefined}
            disabled={disabled}
            onChange={(event) => updateOther(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !multiline
              ) {
                event.preventDefault();
                submitOther();
              }
            }}
            className={cn(
              'block min-h-0! w-full resize-none overflow-hidden rounded-none border-0 bg-transparent hover:bg-transparent p-0 text-foreground shadow-none placeholder:text-muted-foreground',
              compact ? 'text-xs' : 'type-caption',
            )}
          />
        </div>
      ) : (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The runtime role is radiogroup or group; keyboard delegation belongs to this source container.
        <div
          ref={rowsElement}
          role={isMulti ? 'group' : 'radiogroup'}
          aria-labelledby={titleId}
          className={cn('relative flex flex-col gap-0.5', compact ? '-mx-2.5' : '-mx-3')}
          onFocus={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>(
              '[data-proximity-index]',
            );
            if (row) hoverRef.current?.setActiveIndex(Number(row.dataset.proximityIndex));
          }}
          onBlur={(event) => {
            if (!rowsElement.current?.contains(event.relatedTarget as Node))
              hoverRef.current?.setActiveIndex(null);
          }}
          onKeyDown={handleRowsKeydown}
        >
          {hover && (
            <ProximityHighlight
              store={hover}
              selectedIndexes={selectedIndexes}
              selectedClass="bg-selected"
              hoverClass={hover.activeIndex === otherIndex ? 'bg-transparent' : 'bg-hover'}
            />
          )}
          {options.map((option, optionIndex) => {
            const id = option.id ?? `o-${optionIndex}`;
            const selected = selectedIds.includes(id);
            const chipPosition = question.chipPosition ?? 'right';
            const hasStackedDescription =
              question.layout === 'stacked' && Boolean(option.description?.trim());
            const actionArrow = (
              <span
                aria-hidden="true"
                className="absolute inset-0 inline-flex scale-75 items-center justify-center rounded-(--radius-small) bg-primary text-primary-foreground opacity-0 transition-[opacity,transform] duration-spring-fast ease-spring-fast group-hover/question-row:scale-100 group-hover/question-row:opacity-100 group-focus/question-row:scale-100 group-focus/question-row:opacity-100 motion-reduce:transition-none"
              >
                <ArrowRight />
              </span>
            );
            const chip = (
              <span
                className={cn(
                  'relative inline-flex shrink-0 items-center justify-center',
                  compact ? 'size-6' : 'size-7',
                  hasStackedDescription && '-mt-px',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inline-flex items-center justify-center text-xs transition-[opacity,font-weight] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                    compact ? 'size-[18px]' : 'size-5',
                    isMulti && 'rounded-(--radius-small) border',
                    isMulti && selected
                      ? 'border-primary bg-primary font-semibold text-primary-foreground'
                      : isMulti
                        ? 'border-border text-muted-foreground'
                        : selected
                          ? 'font-semibold text-foreground'
                          : 'text-muted-foreground',
                    chipPosition === 'right' &&
                      !isMulti &&
                      'group-hover/question-row:opacity-0 group-focus/question-row:opacity-0',
                  )}
                >
                  {formatInteger(optionIndex + 1)}
                </span>
                {chipPosition === 'right' && !isMulti && actionArrow}
              </span>
            );
            return (
              // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The runtime role is radio or checkbox, with checked state and keyboard activation.
              <div
                key={id}
                ref={rowRefs[optionIndex]}
                data-proximity-index={optionIndex}
                data-chip-position={chipPosition}
                data-layout={question.layout ?? 'inline'}
                data-state={selected ? 'checked' : 'unchecked'}
                role={isMulti ? 'checkbox' : 'radio'}
                aria-checked={selected}
                aria-disabled={optionsLocked || undefined}
                tabIndex={
                  !optionsLocked &&
                  (optionIndex === firstSelectedIndex ||
                    (firstSelectedIndex < 0 && optionIndex === 0))
                    ? 0
                    : -1
                }
                className={cn(
                  'group/question-row relative z-10 flex cursor-pointer select-none',
                  compact ? 'px-2.5' : 'px-3',
                  chipPosition === 'left' ? 'gap-2' : 'gap-3',
                  hasStackedDescription ? 'items-start' : 'items-center',
                  hasStackedDescription
                    ? compact
                      ? 'min-h-12 py-1'
                      : 'min-h-14 py-2'
                    : compact
                      ? 'min-h-8 py-1'
                      : 'min-h-10 py-1.5',
                  'rounded-(--radius-small)',
                )}
                onMouseDown={(event) => {
                  if (
                    (event.target as HTMLElement).closest(
                      'button, a, input, select, textarea, [contenteditable]',
                    )
                  )
                    return;
                  event.preventDefault();
                  event.currentTarget.focus();
                }}
                onClick={() => {
                  if (!optionsLocked) {
                    if (isMulti) toggleMulti(id);
                    else selectSingle(id);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    !event.nativeEvent.isComposing &&
                    !event.defaultPrevented &&
                    (event.key === ' ' || event.key === 'Enter') &&
                    !event.metaKey &&
                    !event.ctrlKey
                  ) {
                    event.preventDefault();
                    if (isMulti) toggleMulti(id);
                    else selectSingle(id);
                  }
                }}
              >
                {chipPosition === 'left' && chip}
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words leading-snug',
                    compact ? 'text-xs' : 'type-caption',
                    question.layout === 'stacked'
                      ? 'flex flex-col gap-0.5'
                      : 'inline-flex items-center',
                  )}
                >
                  <span className="font-normal text-foreground">{option.title}</span>
                  {option.description && (
                    <>
                      {question.layout !== 'stacked' && <span aria-hidden="true">&nbsp;</span>}
                      <span
                        className={cn(
                          'text-muted-foreground',
                          question.layout === 'stacked' && 'text-xs',
                        )}
                      >
                        {option.description}
                      </span>
                    </>
                  )}
                </span>
                {chipPosition === 'right'
                  ? chip
                  : !isMulti && (
                      <span className="relative inline-flex size-7 shrink-0 items-center justify-center">
                        {actionArrow}
                      </span>
                    )}
              </div>
            );
          })}
          {allowOther && (
            <div
              role="presentation"
              ref={rowRefs[otherIndex]}
              data-proximity-index={otherIndex}
              data-chip-position={question.chipPosition ?? 'right'}
              data-state={
                otherText.length > 0 || currentAnswer?.hasAttachments ? 'checked' : 'unchecked'
              }
              className={cn(
                'relative z-10 flex cursor-text rounded-(--radius-small)',
                question.otherAutoGrowMaxLines ? 'items-start' : 'items-center',
                compact ? 'px-2.5' : 'px-3',
                question.chipPosition === 'left' ? 'gap-2' : 'gap-3',
                compact ? 'min-h-8 py-1' : 'min-h-10 py-1.5',
              )}
              onPointerDown={(event) => {
                if (event.target !== otherInput.current) otherInput.current?.focus();
              }}
            >
              {question.chipPosition === 'left' && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center text-xs',
                    compact ? 'size-6' : 'size-7',
                  )}
                >
                  {otherIndex + 1}
                </span>
              )}
              <Textarea
                ref={otherInput}
                noFocusStyle
                rows={1}
                value={otherText}
                placeholder={question.otherPlaceholder ?? m.ui_askUserQuestions_other_placeholder()}
                aria-label={
                  question.otherAriaLabel ??
                  question.otherPlaceholder ??
                  m.ui_askUserQuestions_other_ariaLabel()
                }
                disabled={disabled}
                onPaste={(event) => {
                  if (!disabled) onOtherPaste?.(event, questionId);
                }}
                onChange={(event) => updateOther(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    (!isMulti || question.otherEnterSubmits)
                  ) {
                    event.preventDefault();
                    if (isMulti && otherText.trim().length === 0) finishMulti();
                    else submitOther();
                  }
                }}
                onClick={(event) => event.stopPropagation()}
                className={cn(
                  'min-h-0! min-w-0 flex-1 rounded-none border-0 bg-transparent hover:bg-transparent p-0 leading-snug text-foreground shadow-none placeholder:text-muted-foreground',
                  compact ? 'text-xs' : 'type-caption',
                  question.otherAutoGrowMaxLines
                    ? 'min-h-[1lh]! resize-y overflow-y-auto'
                    : 'resize-none overflow-hidden',
                )}
              />
              {question.chipPosition !== 'left' && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center text-xs',
                    compact ? 'size-6' : 'size-7',
                  )}
                >
                  {otherIndex + 1}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {allowOther && otherAttachments?.(questionId)}
      {showFooter && (
        <div className={cn('pt-1', compact ? 'pb-1.5' : 'pb-2')}>
          <div
            data-slot="ask-user-questions-footer"
            className={cn(
              '-mx-2 flex flex-wrap items-center gap-2 sm:-mx-3',
              centered ? 'justify-center' : 'justify-between',
            )}
          >
            <div
              className={cn(
                'relative flex min-w-0 max-w-full flex-wrap items-center gap-1',
                centered
                  ? !footerActions && !showBackAction && !freeTextError && 'hidden'
                  : 'flex-1',
              )}
            >
              {footerActions}
              <QuestionAction show={showBackAction}>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={<ArrowLeft />}
                  className="pl-3 sm:pl-1.5"
                  disabled={disabled}
                  onClick={back}
                >
                  {backLabel}
                </Button>
              </QuestionAction>
              {freeTextError && <QuestionError id={errorId}>{freeTextError}</QuestionError>}
            </div>
            <div
              className={cn(
                'relative flex min-w-0 max-w-full flex-wrap items-center gap-2',
                centered && 'justify-center',
              )}
            >
              <QuestionAction show={showSkip}>
                <Button
                  variant="ghost"
                  size="sm"
                  trailingIcon={<SkipArrow />}
                  className="pr-3 sm:pr-[6px]"
                  disabled={disabled}
                  onClick={skip}
                >
                  {skipLabel}
                </Button>
              </QuestionAction>
              <QuestionAction show={showSubmit}>
                <Button
                  variant="primary"
                  size="sm"
                  trailingIcon={<Shortcut />}
                  className="pr-3 sm:pr-[6px]"
                  disabled={!canSubmit}
                  onClick={isFreeText ? submitOther : finishMulti}
                >
                  {question.nextLabel ??
                    (safeIndex >= questionCount - 1
                      ? m.ui_askUserQuestions_finish_label()
                      : m.chat_questionWizard_next_label())}
                </Button>
              </QuestionAction>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
