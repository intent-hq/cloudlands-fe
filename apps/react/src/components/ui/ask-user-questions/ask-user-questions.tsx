/* oxlint-disable jsx-a11y/no-static-element-interactions -- The source root delegates bubbled shortcuts; its child radio/checkbox/text controls own interaction semantics. */
// Source: src/lib/components/ui/ask-user-questions/ask-user-questions.svelte.
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SizeProvider, useSize } from '@/components/ui/size-context';
import { clampSurface, surfaceClasses, useSurface } from '@/components/ui/surface-context';
import { useAnimatedHeight, usePresence } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { QuestionStep, type QuestionStepHandle, type QuestionStepProps } from './question-step';
import type { AskUserAnswer, AskUserQuestionsProps } from './types';

type Answers = Record<string, AskUserAnswer>;
const mountedInstances: HTMLElement[] = [];

export function AskUserQuestions({
  questions,
  currentIndex,
  defaultCurrentIndex = 0,
  onCurrentIndexChange,
  answers: controlledAnswers,
  defaultAnswers = {},
  onAnswersChange,
  onComplete,
  onBack,
  restoreFocusOnNavigate = false,
  size,
  className,
  onKeyDown,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
  ...props
}: AskUserQuestionsProps) {
  const uid = useId();
  const contextSize = useSize();
  const surface = useSurface();
  const resolvedSize = size ?? contextSize;
  const compact = resolvedSize === 'compact';
  const [internalIndex, setInternalIndex] = useState(defaultCurrentIndex);
  const [internalAnswers, setInternalAnswers] = useState<Answers>(() => ({ ...defaultAnswers }));
  // This journal is deliberately ahead of controlled props within an interaction.
  // It is never used as the rendered source of truth for a controlled component.
  const latestAnswers = useRef(controlledAnswers ?? internalAnswers);
  useLayoutEffect(() => {
    if (controlledAnswers !== undefined) latestAnswers.current = controlledAnswers;
  }, [controlledAnswers]);
  const currentAnswers = controlledAnswers ?? internalAnswers;
  const safeIndex = Math.max(
    0,
    Math.min(currentIndex ?? internalIndex, Math.max(0, questions.length - 1)),
  );
  const question = questions[safeIndex];
  const questionId = question ? (question.id ?? `q-${safeIndex}`) : '';
  const root = useRef<HTMLDivElement>(null);
  const step = useRef<QuestionStepHandle | null>(null);
  const focusRequested = useRef(false);
  const registerStepHandle = useCallback((handle: QuestionStepHandle) => {
    step.current = handle;
    return () => {
      if (step.current === handle) step.current = null;
    };
  }, []);

  const restoreFirstRow = () => {
    queueMicrotask(() => step.current?.restoreFirstRow());
  };
  const wantsFocus = () =>
    restoreFocusOnNavigate && Boolean(root.current?.contains(document.activeElement));
  function setIndex(next: number, snapshot = latestAnswers.current) {
    focusRequested.current = wantsFocus();
    if (currentIndex === undefined) setInternalIndex(next);
    onCurrentIndexChange?.(next, snapshot);
    if (focusRequested.current) restoreFirstRow();
  }
  useLayoutEffect(() => {
    if (focusRequested.current) {
      focusRequested.current = false;
      step.current?.restoreFirstRow();
    }
  }, [safeIndex]);
  function writeAnswers(update: (previous: Answers) => Answers) {
    const next = update(latestAnswers.current);
    latestAnswers.current = next;
    if (controlledAnswers === undefined) setInternalAnswers(next);
    onAnswersChange?.(next);
    return next;
  }
  function goNext(snapshot: Answers) {
    if (safeIndex >= questions.length - 1) onComplete?.(snapshot);
    else setIndex(safeIndex + 1, snapshot);
  }
  function back() {
    if (props.disabled) return;
    const shouldRestore = wantsFocus();
    onBack?.(safeIndex);
    if (!onBack && safeIndex > 0) setIndex(safeIndex - 1);
    else if (shouldRestore) {
      focusRequested.current = true;
      restoreFirstRow();
    }
  }

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const doc = node.ownerDocument;
    mountedInstances.push(node);
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const modal = target?.closest<HTMLElement>('[aria-modal="true"]');
      if (modal && !modal.contains(node)) return;
      const instances = mountedInstances.filter((element) => element.ownerDocument === doc);
      const activeInstance = instances.find((element) => element.contains(doc.activeElement));
      if (activeInstance ? activeInstance !== node : instances.at(-1) !== node) return;
      if (target && instances.some((element) => element !== node && element.contains(target)))
        return;
      step.current?.handleDocumentKeydown(event);
    };
    doc.addEventListener('keydown', keydown);
    return () => {
      doc.removeEventListener('keydown', keydown);
      const index = mountedInstances.indexOf(node);
      if (index >= 0) mountedInstances.splice(index, 1);
    };
  }, []);

  const stepProps = {
    ...props,
    question,
    questionId,
    safeIndex,
    questionCount: questions.length,
    compact,
    surface,
    uid,
    currentAnswer: currentAnswers[questionId],
    latestAnswers,
    writeAnswers,
    goNext,
    back,
    registerStepHandle,
  };
  const showCounter = props.showCounter ?? true;
  return (
    <SizeProvider size={resolvedSize}>
      <div
        ref={root}
        id={id}
        aria-label={ariaLabel}
        data-testid={testId}
        data-slot="ask-user-questions"
        className={cn(
          'relative w-full max-w-[520px] overflow-hidden rounded-(--radius-large) border border-border',
          surfaceClasses(clampSurface(surface + 1)),
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) step.current?.handleRootKeydown(event.nativeEvent);
        }}
      >
        {!question ? (
          // i18n-ignore (reference primitive empty-state default)
          <p className="p-5 text-[13px] text-muted-foreground">No questions.</p>
        ) : (
          showCounter && (
            <div
              data-slot="ask-user-questions-metadata"
              className={cn(
                'flex items-center text-muted-foreground type-caption',
                props.centered && 'justify-center text-center',
                compact ? 'px-5 pt-2.5 pb-1.5' : 'px-5 pt-3.5 pb-2 sm:pt-4',
              )}
            >
              {/* i18n-ignore (reference primitive progress label) */}
              <span className="shrink-0 tabular-nums">
                Question {safeIndex + 1} of {questions.length}
              </span>
            </div>
          )
        )}
        <QuestionDeck stepProps={question ? { ...stepProps, question } : null} />
      </div>
    </SizeProvider>
  );
}

function QuestionDeck({
  stepProps,
}: {
  stepProps: Omit<QuestionStepProps, 'present' | 'onExit'> | null;
}) {
  const height = useRef<HTMLDivElement>(null);
  useAnimatedHeight(height);
  // Keep keyed outgoing content isolated from the incoming question's refs and keyboard owner.
  const items = useMemo(() => (stepProps ? [stepProps] : []), [stepProps]);
  const presence = usePresence(items, (item) => item.questionId);
  return (
    <div ref={height}>
      <div className="grid">
        {presence.entries.map(({ key, value, present }) => (
          <QuestionStep
            key={key}
            {...value}
            present={present}
            onExit={() => presence.remove(key)}
          />
        ))}
      </div>
    </div>
  );
}
