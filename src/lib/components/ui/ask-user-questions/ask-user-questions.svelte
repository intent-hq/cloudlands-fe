<script module lang="ts">
  import type { AskUserAnswer, AskUserOption, AskUserQuestionsProps } from './types';

  const mountedInstances: HTMLElement[] = [];
  const DEFAULT_FREE_TEXT_PLACEHOLDER = 'Type your answer…'; // i18n-ignore (public primitive API default from reference)
  const DEFAULT_OTHER_PLACEHOLDER = 'Describe in your own words…'; // i18n-ignore (public primitive API default from reference)
  const DEFAULT_OTHER_ARIA_LABEL = 'Describe in your own words'; // i18n-ignore (public primitive API default from reference)
  const DEFAULT_BACK_LABEL = 'Back'; // i18n-ignore (optional primitive navigation default)
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ProximityHighlight } from '$lib/components/ui/proximity-highlight';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import { clampSurface, surfaceClasses, useSurface } from '$lib/components/ui/surface-context';
  import { Textarea } from '$lib/components/ui/textarea';
  import { createProximityHover, type ProximityHover } from '$lib/interaction';
  import { animatedHeight, crispOut, scale, springIn } from '$lib/motion';
  import { cn } from '$lib/utils';
  import { onMount, tick, untrack } from 'svelte';
  import type { Action } from 'svelte/action';
  import { useSize } from '$lib/components/ui/size-context';

  let {
    questions,
    currentIndex,
    defaultCurrentIndex = 0,
    onCurrentIndexChange,
    answers: controlledAnswers,
    defaultAnswers = {},
    onAnswersChange,
    onComplete,
    onSkip,
    skipLabel = 'Skip', // i18n-ignore (public primitive API default from reference)
    onBack,
    showBack = false,
    backLabel = DEFAULT_BACK_LABEL,
    headerActions,
    showCounter = true,
    alwaysShowSkip = false,
    showOtherSubmit = false,
    exclusiveOther = false,
    clearOnSkip = false,
    globalKeyboardShortcuts = false,
    restoreFocusOnNavigate = false,
    disabled = false,
    size,
    class: className,
    onkeydown,
    ...restProps
  }: AskUserQuestionsProps = $props();

  const uid = $props.id();
  const contextSize = useSize();
  const surface = useSurface();
  let internalIndex = $state(untrack(() => defaultCurrentIndex));
  let internalAnswers = $state<Record<string, AskUserAnswer>>(
    untrack(() => ({ ...defaultAnswers })),
  );
  let latestAnswers = $state<Record<string, AskUserAnswer>>(
    untrack(() => controlledAnswers ?? internalAnswers),
  );
  let rootElement = $state<HTMLElement | null>(null);
  let rowsElement = $state<HTMLElement | null>(null);
  let otherInput = $state<HTMLTextAreaElement | null>(null);
  let hover = $state<ProximityHover>();
  let freeTextError = $state<string | null>(null);
  const pendingRows = new Map<number, HTMLElement>();

  const resolvedSize = $derived(size ?? contextSize);
  const compact = $derived(resolvedSize === 'compact');
  const index = $derived(currentIndex ?? internalIndex);
  const safeIndex = $derived(Math.max(0, Math.min(index, Math.max(0, questions.length - 1))));
  const question = $derived(questions[safeIndex]);
  const questionId = $derived(question ? (question.id ?? `q-${safeIndex}`) : '');
  const titleId = $derived(`${uid}-${questionId}-title`);
  const errorId = $derived(`${uid}-${questionId}-error`);
  const currentAnswers = $derived(controlledAnswers ?? internalAnswers);
  const currentAnswer = $derived(currentAnswers[questionId]);
  const selectedIds = $derived(currentAnswer?.selectedIds ?? []);
  const otherText = $derived(currentAnswer?.otherText ?? '');
  const options = $derived(question?.options ?? []);
  const isMulti = $derived(Boolean(question?.multiSelect));
  const isFreeText = $derived(Boolean(question?.freeText));
  const multiline = $derived(question?.freeTextMultiline !== false);
  const allowOther = $derived(!isFreeText && Boolean(question?.allowOther));
  const otherIndex = $derived(allowOther ? options.length : -1);
  const rowCount = $derived(options.length + (allowOther ? 1 : 0));
  const firstSelectedIndex = $derived(
    options.findIndex((option, optionIndex) =>
      selectedIds.includes(option.id ?? `o-${optionIndex}`),
    ),
  );
  const selectedIndexes = $derived.by(() => {
    const indexes = new Set<number>();
    options.forEach((option, optionIndex) => {
      if (selectedIds.includes(option.id ?? `o-${optionIndex}`)) indexes.add(optionIndex);
    });
    if (allowOther && otherText.length > 0) indexes.add(otherIndex);
    return indexes;
  });
  const canSubmit = $derived(
    !disabled &&
      (isFreeText
        ? otherText.trim().length > 0
        : selectedIds.length > 0 || otherText.trim().length > 0),
  );
  const optionsLocked = $derived(disabled || (exclusiveOther && !isMulti && otherText.length > 0));
  const showSkip = $derived(
    (alwaysShowSkip || questions.length > 1) && question?.skippable !== false,
  );
  const showSubmit = $derived(
    isMulti || isFreeText || (showOtherSubmit && allowOther && otherText.trim().length > 0),
  );
  const showBackAction = $derived(showBack && safeIndex > 0);
  const showFooter = $derived(showBackAction || showSkip || showSubmit || Boolean(freeTextError));

  $effect(() => {
    if (controlledAnswers !== undefined) latestAnswers = controlledAnswers;
  });

  $effect(() => {
    questionId;
    freeTextError = null;
    hover?.setActiveIndex(null);
    if (isFreeText) {
      void tick().then(() => otherInput?.focus({ preventScroll: true }));
    }
  });

  $effect(() => {
    otherText;
    questionId;
    void tick().then(() => {
      if (!otherInput) return;
      otherInput.style.height = '0px';
      otherInput.style.height = `${otherInput.scrollHeight}px`;
      hover?.measure();
    });
  });

  const connectRows: Action<HTMLElement> = (node) => {
    rowsElement = node;
    hover = createProximityHover(node);
    pendingRows.forEach((element, rowIndex) => hover?.registerItem(rowIndex, element));
    return {
      destroy() {
        hover?.destroy();
        hover = undefined;
        rowsElement = null;
      },
    };
  };

  const registerRow: Action<HTMLElement, number> = (node, rowIndex) => {
    let registeredIndex = rowIndex;
    pendingRows.set(registeredIndex, node);
    hover?.registerItem(registeredIndex, node);
    return {
      update(nextIndex) {
        if (nextIndex === registeredIndex) return;
        pendingRows.delete(registeredIndex);
        hover?.registerItem(registeredIndex, null);
        registeredIndex = nextIndex;
        pendingRows.set(registeredIndex, node);
        hover?.registerItem(registeredIndex, node);
      },
      destroy() {
        pendingRows.delete(registeredIndex);
        hover?.registerItem(registeredIndex, null);
      },
    };
  };

  onMount(() => {
    if (rootElement) mountedInstances.push(rootElement);
    document.addEventListener('keydown', handleDocumentKeydown);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeydown);
      const mountedIndex = rootElement ? mountedInstances.indexOf(rootElement) : -1;
      if (mountedIndex >= 0) mountedInstances.splice(mountedIndex, 1);
    };
  });

  function optionId(option: AskUserOption, optionIndex: number) {
    return option.id ?? `o-${optionIndex}`;
  }

  function writeAnswers(
    update: (previous: Record<string, AskUserAnswer>) => Record<string, AskUserAnswer>,
  ) {
    const next = update(latestAnswers);
    latestAnswers = next;
    if (controlledAnswers === undefined) internalAnswers = next;
    onAnswersChange?.(next);
    return next;
  }

  function setIndex(next: number) {
    const shouldRestoreFocus =
      restoreFocusOnNavigate && rootElement?.contains(document.activeElement);
    if (currentIndex === undefined) internalIndex = next;
    onCurrentIndexChange?.(next);
    if (shouldRestoreFocus) restoreFirstRow();
  }

  function restoreFirstRow() {
    void tick().then(() => {
      const firstRow = pendingRows.get(0);
      if (firstRow?.getAttribute('aria-disabled') !== 'true') firstRow?.focus();
    });
  }

  function goNext(snapshot: Record<string, AskUserAnswer>) {
    if (safeIndex >= questions.length - 1) onComplete?.(snapshot);
    else setIndex(safeIndex + 1);
  }

  function selectSingle(id: string) {
    if (!question || optionsLocked) return;
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: [id],
        otherText: previous[questionId]?.otherText || undefined,
        skipped: false,
      },
    }));
    goNext(snapshot);
  }

  function toggleMulti(id: string) {
    if (!question || disabled) return;
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
          skipped: false,
        },
      };
    });
  }

  function updateOther(text: string) {
    if (disabled) return;
    freeTextError = null;
    writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds:
          exclusiveOther && !isMulti && text.length > 0
            ? []
            : (previous[questionId]?.selectedIds ?? []),
        otherText: text,
        skipped: false,
      },
    }));
  }

  function submitOther() {
    if (!question || disabled) return;
    const text = (latestAnswers[questionId]?.otherText ?? '').trim();
    if (!text) return;
    if (isFreeText && question.freeTextValidate) {
      const validationMessage = question.freeTextValidate(text);
      if (validationMessage) {
        freeTextError = validationMessage;
        return;
      }
    }
    freeTextError = null;
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: previous[questionId]?.selectedIds ?? [],
        otherText: text,
        skipped: false,
      },
    }));
    goNext(snapshot);
  }

  function skip() {
    if (!question || disabled) return;
    const snapshot = writeAnswers((previous) => ({
      ...previous,
      [questionId]: {
        questionId,
        selectedIds: clearOnSkip ? [] : (previous[questionId]?.selectedIds ?? []),
        otherText: clearOnSkip ? undefined : previous[questionId]?.otherText,
        skipped: true,
      },
    }));
    onSkip?.(questionId, safeIndex);
    goNext(snapshot);
  }

  function back() {
    if (disabled) return;
    const shouldRestoreFocus =
      restoreFocusOnNavigate && rootElement?.contains(document.activeElement);
    onBack?.(safeIndex);
    if (!onBack && safeIndex > 0) setIndex(safeIndex - 1);
    else if (shouldRestoreFocus) restoreFirstRow();
  }

  function finishMulti() {
    if (!canSubmit) return;
    if (!isMulti && allowOther) submitOther();
    else goNext(latestAnswers);
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (!question || disabled || !rootElement) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const activeInstance = mountedInstances.find((element) =>
      element.contains(document.activeElement),
    );
    if (activeInstance ? activeInstance !== rootElement : mountedInstances.at(-1) !== rootElement)
      return;
    if (
      target &&
      mountedInstances.some((element) => element !== rootElement && element.contains(target))
    )
      return;
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
    if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable))
      return;
    if (event.key < '1' || event.key > '9') return;
    const optionIndex = Number.parseInt(event.key, 10) - 1;
    if (optionIndex < options.length) {
      event.preventDefault();
      const id = optionId(options[optionIndex], optionIndex);
      if (isMulti) toggleMulti(id);
      else if (!optionsLocked) selectSingle(id);
    } else if (allowOther && optionIndex === options.length) {
      event.preventDefault();
      otherInput?.focus();
    }
  }

  function focusRow(rowIndex: number) {
    if (allowOther && rowIndex === otherIndex) otherInput?.focus();
    else rowsElement?.querySelector<HTMLElement>(`[data-proximity-index="${rowIndex}"]`)?.focus();
    hover?.setActiveIndex(rowIndex);
  }

  function handleRowsKeydown(event: KeyboardEvent) {
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
      const base = isTextInput ? otherIndex : (hover?.activeIndex ?? -1);
      next = (base + (event.key === 'ArrowDown' ? 1 : -1) + rowCount) % rowCount;
    }
    focusRow(next);
  }

  function handleRootKeydown(event: KeyboardEvent) {
    onkeydown?.(event);
    if (event.defaultPrevented || event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey))
      return;
    if (!isMulti && !isFreeText) return;
    event.preventDefault();
    if (isFreeText) submitOther();
    else finishMulti();
  }

  function handleRowMousedown(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [contenteditable]')) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus();
  }

  function handleRowsFocus(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-proximity-index]');
    if (!row) return;
    const rowIndex = Number(row.dataset.proximityIndex);
    hover?.setActiveIndex(rowIndex);
  }

  function handleRowsBlur(event: FocusEvent) {
    if (rowsElement?.contains(event.relatedTarget as Node)) return;
    hover?.setActiveIndex(null);
  }

  function stepOut(node: HTMLElement) {
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    return crispOut(node, { tier: 'fast', y: -2 });
  }

  function stepIn(node: HTMLElement) {
    node.inert = false;
    node.removeAttribute('aria-hidden');
    return springIn(node, { tier: 'slow', y: 4, scale: 1 });
  }
</script>

{#snippet arrowLeft()}
  <svg class="hidden size-3.5 sm:block" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h8"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet arrowRight()}
  <svg class="hidden size-3.5 sm:block" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="m6.5 3.5 4.5 4.5-4.5 4.5M3 8h8"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{/snippet}

{#snippet shortcut()}
  <kbd
    aria-hidden="true"
    class="hidden h-[18px] min-w-[18px] items-center justify-center rounded-(--radius-small) bg-primary-ink/15 px-1 font-sans text-[11px] leading-none tracking-wide text-primary-ink sm:inline-flex"
  >
    {typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : '⌃'}↵
  </kbd>
{/snippet}

{#snippet component()}
  <div
    bind:this={rootElement}
    class={cn(
      'relative w-full max-w-[520px] overflow-hidden rounded-(--radius-large) border border-border',
      surfaceClasses(clampSurface(surface + 1)),
      className,
    )}
    onkeydown={handleRootKeydown}
    {...restProps}
  >
    {#if !question}
      <!-- i18n-ignore (reference primitive empty-state default) -->
      <p class="p-5 text-[13px] text-muted-foreground">No questions.</p>
    {:else}
      <div
        data-slot="ask-user-questions-metadata"
        class={cn(
          'flex items-center text-muted-foreground',
          compact
            ? 'px-3.5 pt-2.5 pb-1.5 text-[11px] sm:px-4 sm:pt-3'
            : 'px-4 pt-3.5 pb-2 text-[12px] sm:px-5 sm:pt-4',
        )}
      >
        {#if showCounter}
          <!-- i18n-ignore (reference primitive progress label) -->
          <span class="shrink-0 tabular-nums">Question {safeIndex + 1} of {questions.length}</span>
        {/if}
        {#if headerActions}
          <span class="ml-auto flex shrink-0 items-center gap-1">
            {@render headerActions()}
          </span>
        {/if}
      </div>

      <div use:animatedHeight={true}>
        <div class="grid">
          {#key questionId}
            <div
              data-animated-height-target
              class={cn(
                'col-start-1 row-start-1 flex flex-col gap-2',
                compact ? 'px-3.5 sm:px-4' : 'px-4 sm:px-5',
                showFooter ? 'pb-1' : compact ? 'pb-2 sm:pb-2.5' : 'pb-2.5 sm:pb-3',
              )}
              in:stepIn
              out:stepOut
            >
              {#if question.header}
                <p class="text-[12px] font-medium leading-snug text-muted-foreground">
                  {question.header}
                </p>
              {/if}
              <h3 id={titleId} class="text-[16px] font-semibold leading-snug text-foreground">
                {question.title}
              </h3>
              {#if question.description}
                <p class="text-[12px] leading-snug text-muted-foreground">
                  {question.description}
                </p>
              {/if}

              {#if isFreeText}
                <div
                  role="group"
                  aria-labelledby={titleId}
                  class={cn(
                    'relative mt-1 cursor-text rounded-(--radius-small) transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                    compact ? '-mx-2.5 px-2.5 py-2' : '-mx-3 px-3 py-2.5',
                    multiline ? 'min-h-[76px]' : compact ? 'min-h-8' : 'min-h-10',
                    otherText.length > 0
                      ? 'bg-active'
                      : 'hover:bg-hover focus-within:bg-card focus-within:ring-1 focus-within:ring-border focus-within:ring-inset',
                  )}
                  onpointerdown={(event) => {
                    if (event.target !== otherInput) otherInput?.focus();
                  }}
                >
                  <Textarea
                    bind:ref={otherInput}
                    rows={1}
                    value={otherText}
                    noFocusStyle
                    placeholder={question.freeTextPlaceholder ?? DEFAULT_FREE_TEXT_PLACEHOLDER}
                    aria-labelledby={titleId}
                    aria-describedby={freeTextError ? errorId : undefined}
                    aria-invalid={freeTextError ? 'true' : undefined}
                    oninput={(event) => updateOther(event.currentTarget.value)}
                    onkeydown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !multiline
                      ) {
                        event.preventDefault();
                        submitOther();
                      }
                    }}
                    class={cn(
                      'block min-h-0! w-full resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 text-foreground shadow-none outline-none placeholder:text-muted-foreground',
                      compact ? 'text-[12px]' : 'text-[13px]',
                    )}
                  />
                </div>
              {:else}
                <div
                  bind:this={rowsElement}
                  use:connectRows
                  role={isMulti ? 'group' : 'radiogroup'}
                  aria-labelledby={titleId}
                  class="relative -mx-3 flex flex-col gap-0.5"
                  onfocusin={handleRowsFocus}
                  onfocusout={handleRowsBlur}
                  onkeydown={handleRowsKeydown}
                >
                  {#if hover}
                    <ProximityHighlight
                      store={hover}
                      {selectedIndexes}
                      selectedClass="bg-selected"
                    />
                  {/if}

                  {#each options as option, optionIndex (optionId(option, optionIndex))}
                    {@const id = optionId(option, optionIndex)}
                    {@const selected = selectedIds.includes(id)}
                    {@const chipPosition = question.chipPosition ?? 'right'}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (the runtime role is radio or checkbox) -->
                    <div
                      use:registerRow={optionIndex}
                      data-proximity-index={optionIndex}
                      data-chip-position={chipPosition}
                      data-layout={question.layout ?? 'inline'}
                      data-state={selected ? 'checked' : 'unchecked'}
                      role={isMulti ? 'checkbox' : 'radio'}
                      aria-checked={selected}
                      aria-disabled={optionsLocked || undefined}
                      tabindex={!optionsLocked &&
                      (optionIndex === firstSelectedIndex ||
                        (firstSelectedIndex < 0 && optionIndex === 0))
                        ? 0
                        : -1}
                      class={cn(
                        'group/question-row relative z-10 flex cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        chipPosition === 'left' ? 'gap-2 pl-1.5 pr-3' : 'gap-3 pr-1.5 pl-3',
                        question.layout === 'stacked' ? 'items-start' : 'items-center',
                        question.layout === 'stacked'
                          ? compact
                            ? 'min-h-12 py-1.5'
                            : 'min-h-14 py-2'
                          : compact
                            ? 'min-h-8 py-1'
                            : 'min-h-10 py-1.5',
                        'rounded-(--radius-small)',
                      )}
                      onmousedown={handleRowMousedown}
                      onclick={() => {
                        if (optionsLocked) return;
                        if (isMulti) toggleMulti(id);
                        else selectSingle(id);
                      }}
                      onkeydown={(event) => {
                        if (
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
                      {#snippet chip()}
                        <span
                          class={cn(
                            'relative inline-flex shrink-0 items-center justify-center',
                            compact ? 'size-6' : 'size-7',
                            question.layout === 'stacked' && '-mt-px',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            class={cn(
                              'absolute inline-flex items-center justify-center text-[11px] transition-[opacity,font-weight] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                              compact ? 'size-[18px]' : 'size-5',
                              isMulti && 'rounded-(--radius-small) border',
                              isMulti && selected
                                ? 'border-primary bg-primary font-semibold text-primary-ink'
                                : isMulti
                                  ? 'border-border text-muted-foreground'
                                  : selected
                                    ? 'font-semibold text-foreground'
                                    : 'text-muted-foreground',
                              chipPosition === 'right' &&
                                !isMulti &&
                                'group-hover/question-row:opacity-0 group-focus/question-row:opacity-0',
                            )}>{optionIndex + 1}</span
                          >
                          {#if chipPosition === 'right' && !isMulti}
                            <span
                              aria-hidden="true"
                              class="absolute inset-0 inline-flex scale-75 items-center justify-center rounded-(--radius-small) bg-primary text-primary-ink opacity-0 transition-[opacity,transform] duration-spring-fast ease-spring-fast group-hover/question-row:scale-100 group-hover/question-row:opacity-100 group-focus/question-row:scale-100 group-focus/question-row:opacity-100 motion-reduce:transition-none"
                            >
                              <svg class="size-3.5" viewBox="0 0 16 16" fill="none"
                                ><path
                                  d="m6.5 3.5 4.5 4.5-4.5 4.5"
                                  stroke="currentColor"
                                  stroke-width="1.75"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                /></svg
                              >
                            </span>
                          {/if}
                        </span>
                      {/snippet}

                      {#if chipPosition === 'left'}{@render chip()}{/if}
                      <span
                        class={cn(
                          'min-w-0 flex-1 leading-snug',
                          compact ? 'text-[12px]' : 'text-[13px]',
                          question.layout === 'stacked'
                            ? 'flex flex-col gap-0.5'
                            : 'inline-flex items-center',
                        )}
                      >
                        <span
                          class={cn(
                            'text-foreground transition-[font-weight] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
                            selected ? 'font-semibold' : 'font-medium',
                          )}>{option.title}</span
                        >
                        {#if option.description}
                          {#if question.layout !== 'stacked'}<span aria-hidden="true">&nbsp;</span
                            >{/if}
                          <span
                            class={cn(
                              'text-muted-foreground',
                              question.layout === 'stacked' &&
                                (compact ? 'text-[11px]' : 'text-[12px]'),
                            )}>{option.description}</span
                          >
                        {/if}
                      </span>
                      {#if chipPosition === 'right'}
                        {@render chip()}
                      {:else if !isMulti}
                        <span
                          class="relative inline-flex size-7 shrink-0 items-center justify-center"
                        >
                          <span
                            aria-hidden="true"
                            class="absolute inset-0 inline-flex scale-75 items-center justify-center rounded-(--radius-small) bg-primary text-primary-ink opacity-0 transition-[opacity,transform] duration-spring-fast ease-spring-fast group-hover/question-row:scale-100 group-hover/question-row:opacity-100 group-focus/question-row:scale-100 group-focus/question-row:opacity-100 motion-reduce:transition-none"
                          >
                            <svg class="size-3.5" viewBox="0 0 16 16" fill="none"
                              ><path
                                d="m6.5 3.5 4.5 4.5-4.5 4.5"
                                stroke="currentColor"
                                stroke-width="1.75"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              /></svg
                            >
                          </span>
                        </span>
                      {/if}
                    </div>
                  {/each}

                  {#if allowOther}
                    <div
                      role="presentation"
                      use:registerRow={otherIndex}
                      data-proximity-index={otherIndex}
                      data-chip-position={question.chipPosition ?? 'right'}
                      data-state={otherText.length > 0 ? 'checked' : 'unchecked'}
                      class={cn(
                        'relative z-10 flex cursor-text items-center rounded-(--radius-small) outline-none',
                        question.chipPosition === 'left'
                          ? 'gap-2 pl-1.5 pr-3'
                          : 'gap-3 pr-1.5 pl-3',
                        compact ? 'min-h-8 py-1' : 'min-h-10 py-1.5',
                      )}
                      onpointerdown={(event) => {
                        if (event.target !== otherInput) otherInput?.focus();
                      }}
                    >
                      {#if question.chipPosition === 'left'}
                        <span
                          aria-hidden="true"
                          class={cn(
                            'inline-flex shrink-0 items-center justify-center text-[11px]',
                            compact ? 'size-6' : 'size-7',
                          )}>{otherIndex + 1}</span
                        >
                      {/if}
                      <Textarea
                        bind:ref={otherInput}
                        rows={1}
                        value={otherText}
                        noFocusStyle
                        placeholder={question.otherPlaceholder ?? DEFAULT_OTHER_PLACEHOLDER}
                        aria-label={question.otherPlaceholder ?? DEFAULT_OTHER_ARIA_LABEL}
                        {disabled}
                        oninput={(event) => updateOther(event.currentTarget.value)}
                        onkeydown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey && !isMulti) {
                            event.preventDefault();
                            submitOther();
                          }
                        }}
                        onclick={(event) => event.stopPropagation()}
                        class={cn(
                          'min-h-0! min-w-0 flex-1 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 leading-snug text-foreground shadow-none outline-none placeholder:text-muted-foreground',
                          compact ? 'text-[12px]' : 'text-[13px]',
                        )}
                      />
                      {#if question.chipPosition !== 'left'}
                        <span
                          aria-hidden="true"
                          class={cn(
                            'inline-flex shrink-0 items-center justify-center text-[11px]',
                            compact ? 'size-6' : 'size-7',
                          )}>{otherIndex + 1}</span
                        >
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if showFooter}
                <div class={cn('pt-1', compact ? 'pb-1.5' : 'pb-2')}>
                  <div class="-mx-2 flex items-center justify-between gap-2 sm:-mx-3">
                    <div class="relative flex min-w-0 flex-1 items-center gap-2">
                      {#if showBackAction}
                        <span
                          in:scale={{ tier: 'fast' }}
                          out:crispOut={{ tier: 'fast', scale: 0.85 }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            leadingIcon={arrowLeft}
                            class="pl-3 sm:pl-1.5"
                            {disabled}
                            onclick={back}>{backLabel}</Button
                          >
                        </span>
                      {/if}
                      {#if freeTextError}
                        <p
                          id={errorId}
                          role="alert"
                          class="min-w-0 px-2 text-left text-[12px] leading-snug text-danger sm:px-3"
                          in:springIn={{ tier: 'fast', y: -2 }}
                        >
                          {freeTextError}
                        </p>
                      {/if}
                    </div>
                    <div class="relative flex items-center gap-2">
                      {#if showSkip}
                        <span
                          in:scale={{ tier: 'fast' }}
                          out:crispOut={{ tier: 'fast', scale: 0.85 }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            trailingIcon={arrowRight}
                            class="pr-3 sm:pr-[6px]"
                            {disabled}
                            onclick={skip}>{skipLabel}</Button
                          >
                        </span>
                      {/if}
                      {#if showSubmit}
                        <span
                          in:scale={{ tier: 'fast' }}
                          out:crispOut={{ tier: 'fast', scale: 0.85 }}
                        >
                          <Button
                            variant="primary"
                            size="sm"
                            trailingIcon={shortcut}
                            class="pr-3 sm:pr-[6px]"
                            disabled={!canSubmit}
                            onclick={isFreeText ? submitOther : finishMulti}
                          >
                            <!-- i18n-ignore (reference primitive action defaults) -->
                            {question.nextLabel ??
                              (safeIndex >= questions.length - 1 ? 'Finish' : 'Continue')}
                          </Button>
                        </span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/key}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#if size}
  <SizeProvider {size}>{@render component()}</SizeProvider>
{:else}
  {@render component()}
{/if}
