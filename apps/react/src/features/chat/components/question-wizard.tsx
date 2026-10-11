// Source: src/lib/components/chat/questions/QuestionWizard.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source labelled group around either disclosure surface, without fieldset styles. */
import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import {
  AskUserQuestions,
  type AskUserAnswer,
  type AskUserQuestion,
} from '@/components/ui/ask-user-questions';
import { Button } from '@/components/ui/button';
import { crispOut, springIn, usePresence, usePresenceTransition } from '@/lib/motion';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { Question } from '$shared/types/question-resource';
import type { QuestionAnswer } from '$lib/components/chat/questions/answer-message';
import type { ContextItem } from '$lib/components/chat/input/context-item';
import type {
  QuestionWizardDraft,
  QuestionWizardDraftAnswer,
} from '../../../../../../src/store/renderer/slices/question-ui/question-ui-types';
import {
  imageFilesToContextItems,
  INLINE_IMAGE_MAX_BYTES,
  REFERENCE_IMAGE_MAX_BYTES,
} from '../utils/image-context-items';
import { AttachmentPreview } from './attachment-preview';
import { DismissQuestionsConfirmDialog } from './dismiss-questions-confirm-dialog';

export type { QuestionAnswer };

export interface QuestionWizardHandle {
  /** Focus never selects an answer or changes the saved draft. */
  focusQuestion: () => boolean;
}

export interface QuestionWizardProps {
  questions: Question[];
  workspaceId?: string;
  draft?: QuestionWizardDraft;
  onDraftChange?: (draft: QuestionWizardDraft) => void;
  onResolved?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: (collapsed: boolean) => void;
  /** Return false to decline admission and retain the editable draft. */
  onComplete?: ((answers: QuestionAnswer[]) => boolean) | ((answers: QuestionAnswer[]) => void);
  onDismiss?: () => Promise<void> | void;
  ref?: Ref<QuestionWizardHandle>;
}

export function QuestionWizard({
  questions,
  workspaceId,
  draft,
  onDraftChange,
  onResolved,
  collapsed = false,
  onToggleCollapsed,
  onComplete,
  onDismiss,
  ref,
}: QuestionWizardProps) {
  const [localDraft, setLocalDraft] = useState<QuestionWizardDraft>(() => ({
    idx: 0,
    answers: questions.map(() => ({ sel: [], text: '', skipped: false })),
  }));
  const { idx, answers } = draft ?? localDraft;
  const [completed, setCompleted] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  // Bytes stay local; the host-owned persisted draft contains only choices/text.
  const [answerImages, setAnswerImages] = useState<Record<string, ContextItem[]>>({});
  const [readingImages, setReadingImages] = useState(false);
  const reading = useRef(false);
  const resolved = useRef(false);
  const admitted = useRef(false);
  const destroyed = useRef(false);
  const latest = useRef({ idx, answers, questions, onDraftChange, onResolved });
  useLayoutEffect(() => {
    latest.current = { idx, answers, questions, onDraftChange, onResolved };
  });
  useLayoutEffect(() => {
    destroyed.current = false;
    return () => {
      destroyed.current = true;
    };
  }, []);

  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      focusQuestion() {
        if (collapsed || completed || confirmingDismiss) return false;
        const control = root.current
          ?.querySelector('[data-question-state="expanded"]:not([inert])')
          ?.querySelector<HTMLElement>(
            '[role="radio"]:not([aria-disabled="true"]), [role="checkbox"]:not([aria-disabled="true"]), textarea:not(:disabled), button:not(:disabled)',
          );
        if (!control) return false;
        control.focus({ preventScroll: true });
        return control.ownerDocument.activeElement === control;
      },
    }),
    [collapsed, completed, confirmingDismiss],
  );

  const primitiveQuestions: AskUserQuestion[] = questions.map((question) => ({
    id: question.attachmentId,
    title: question.question,
    description: question.explanation,
    layout: 'stacked',
    options: question.options.map((option, index) => ({
      id: String(index),
      title: option.label,
      description: option.description,
    })),
    multiSelect: question.multiSelect,
    allowOther: true,
    otherPlaceholder: m.chat_questionWizard_ownAnswer_placeholder(),
    otherAriaLabel: m.chat_questionWizard_ownAnswer_ariaLabel(),
    otherAutoGrowMaxLines: 6,
    otherEnterSubmits: true,
    skippable: true,
    nextLabel: m.chat_questionWizard_next_label(),
  }));
  const primitiveAnswers = Object.fromEntries(
    questions.map((question, index) => {
      const answer = answers[index];
      return [
        question.attachmentId,
        {
          questionId: question.attachmentId,
          selectedIds: answer.sel.map(String),
          otherText: answer.text || undefined,
          hasAttachments: (answerImages[question.attachmentId]?.length ?? 0) > 0,
          skipped: answer.skipped,
        } satisfies AskUserAnswer,
      ];
    }),
  );

  function resolveDraft() {
    if (resolved.current) return;
    resolved.current = true;
    latest.current.onResolved?.();
  }
  function updateDraft(next: QuestionWizardDraft) {
    if (resolved.current) return;
    if (latest.current.onDraftChange) latest.current.onDraftChange(next);
    else setLocalDraft(next);
  }
  function toDraftAnswers(next: Record<string, AskUserAnswer>): QuestionWizardDraftAnswer[] {
    return questions.map((question) => {
      const answer = next[question.attachmentId];
      if (!answer || answer.skipped)
        return { sel: [], text: '', skipped: Boolean(answer?.skipped) };
      const text = answer.otherText ?? '';
      const sel = answer.selectedIds
        .map(Number)
        .filter(
          (index) => Number.isInteger(index) && index >= 0 && index < question.options.length,
        );
      return {
        sel: !question.multiSelect && (text.length > 0 || answer.hasAttachments) ? [] : sel,
        text,
        skipped: false,
      };
    });
  }
  function buildAnswers(source: QuestionWizardDraftAnswer[]): QuestionAnswer[] {
    return questions.map((question, index) => {
      const answer = source[index];
      return {
        question,
        selectedLabels: answer.sel.map((optionIndex) => question.options[optionIndex].label),
        freeText: answer.text.trim(),
        skipped: answer.skipped,
        ...(!answer.skipped && answerImages[question.attachmentId]?.length
          ? {
              imageBlocks: answerImages[question.attachmentId].map((image) => ({
                type: 'image' as const,
                data: image.imageData!,
                mimeType: image.imageMimeType!,
              })),
            }
          : {}),
      };
    });
  }
  function handleAnswersChange(next: Record<string, AskUserAnswer>) {
    if (admitted.current) return;
    setAnswerImages((previous) => {
      const updated = { ...previous };
      for (const question of questions) {
        if (next[question.attachmentId]?.skipped) updated[question.attachmentId] = [];
      }
      return updated;
    });
    updateDraft({ idx, answers: toDraftAnswers(next) });
  }
  async function handleOtherPaste(event: ClipboardEvent<HTMLTextAreaElement>, questionId: string) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    if (reading.current || admitted.current || resolved.current) return;
    reading.current = true;
    setReadingImages(true);
    try {
      const maxBytes =
        workspaceId === CHIEF_WORKSPACE_ID ? INLINE_IMAGE_MAX_BYTES : REFERENCE_IMAGE_MAX_BYTES;
      const images = await imageFilesToContextItems(files, { maxBytes });
      if (destroyed.current || admitted.current || resolved.current || !images.length) return;
      setAnswerImages((previous) => ({
        ...previous,
        [questionId]: [...(previous[questionId] ?? []), ...images],
      }));
      const current = latest.current;
      updateDraft({
        idx: current.idx,
        answers: current.answers.map((answer, index) =>
          current.questions[index].attachmentId === questionId
            ? {
                ...answer,
                sel: current.questions[index].multiSelect ? answer.sel : [],
                skipped: false,
              }
            : answer,
        ),
      });
    } finally {
      reading.current = false;
      if (!destroyed.current) setReadingImages(false);
    }
  }
  function handleComplete(next: Record<string, AskUserAnswer>) {
    if (admitted.current) return;
    const completedAnswers = toDraftAnswers(next);
    updateDraft({ idx, answers: completedAnswers });
    if (onComplete?.(buildAnswers(completedAnswers)) === false) return;
    admitted.current = true;
    setCompleted(true);
    resolveDraft();
  }

  const states = useMemo(() => [collapsed ? 'collapsed' : 'expanded'], [collapsed]);
  const presence = usePresence(states, (state) => state);
  const dismissAction = onDismiss && (
    <Button
      variant="ghost"
      size="xs"
      className="text-danger"
      title={m.chat_questionWizard_dismiss_tooltip()}
      onClick={() => setConfirmingDismiss(true)}
    >
      {m.chat_questionWizard_dismiss_label()}
    </Button>
  );
  return (
    <>
      <div
        ref={root}
        className={
          collapsed
            ? 'relative w-full min-w-0 text-left'
            : 'relative w-full max-w-160 min-w-0 text-left'
        }
        style={{ '--focus-ring': 'var(--muted-foreground)' } as CSSProperties}
        data-question-wizard=""
        role="group"
        aria-label={m.chat_questionWizard_title()}
      >
        {presence.entries.map(({ key, value, present }) => (
          <WizardSurface
            key={key}
            state={value}
            root={root}
            present={present}
            onExit={() => presence.remove(key)}
          >
            {value === 'collapsed' ? (
              <>
                <Button
                  variant="plain"
                  wrapContent={false}
                  className="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5 text-left sm:px-4"
                  aria-expanded={false}
                  onClick={() => onToggleCollapsed?.(false)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="truncate type-caption font-medium text-foreground">
                      {m.chat_questionWizard_title()}
                    </span>
                    <span className="shrink-0 type-caption text-muted-foreground">
                      {formatInteger(questions.length)}
                    </span>
                  </span>
                  <span className="min-w-0 max-w-[40%] truncate type-caption text-muted-foreground">
                    {m.chat_questionWizard_clickToExpand_label()}
                  </span>
                </Button>
                {onDismiss && <div className="shrink-0 pr-1 sm:pr-2">{dismissAction}</div>}
              </>
            ) : (
              <AskUserQuestions
                questions={primitiveQuestions}
                currentIndex={idx}
                answers={primitiveAnswers}
                onCurrentIndexChange={(nextIndex, nextAnswers) => {
                  if (!admitted.current)
                    updateDraft({ idx: nextIndex, answers: toDraftAnswers(nextAnswers) });
                }}
                onAnswersChange={handleAnswersChange}
                onOtherPaste={handleOtherPaste}
                otherAttachments={(questionId) => (
                  <QuestionAttachments
                    images={answerImages[questionId] ?? EMPTY_IMAGES}
                    onRemove={
                      completed || confirmingDismiss || readingImages
                        ? undefined
                        : (id) => {
                            setAnswerImages((previous) => ({
                              ...previous,
                              [questionId]: previous[questionId].filter((image) => image.id !== id),
                            }));
                          }
                    }
                  />
                )}
                onComplete={handleComplete}
                showBack={questions.length > 1}
                onBack={(currentIndex) => {
                  if (!admitted.current)
                    updateDraft({ idx: Math.max(0, currentIndex - 1), answers });
                }}
                backLabel={m.chat_questionWizard_back_label()}
                showCounter={questions.length > 1}
                alwaysShowSkip
                showOtherSubmit
                exclusiveOther
                clearOnSkip
                globalKeyboardShortcuts
                restoreFocusOnNavigate
                disabled={completed || confirmingDismiss || collapsed || readingImages || !present}
                footerActions={
                  <>
                    <Button
                      variant="ghost-light"
                      size="xs"
                      title={m.chat_questionWizard_hide_tooltip()}
                      onClick={() => onToggleCollapsed?.(true)}
                    >
                      {m.chat_questionWizard_hide_label()}
                    </Button>
                    {dismissAction}
                  </>
                }
                className="max-w-none max-h-[var(--question-max-height,60dvh)] overflow-y-auto bg-popover [box-shadow:none]!"
                skipLabel={m.chat_questionWizard_skip_label()}
                size="compact"
                data-testid="question-wizard-card"
              />
            )}
          </WizardSurface>
        ))}
      </div>
      <DismissQuestionsConfirmDialog
        open={confirmingDismiss}
        onConfirm={async () => {
          setConfirmingDismiss(false);
          try {
            await onDismiss?.();
            resolveDraft();
          } catch {
            // The host surfaces the failure; preserve the draft for a retry.
          }
        }}
        onCancel={() => setConfirmingDismiss(false)}
      />
    </>
  );
}

const EMPTY_IMAGES: ContextItem[] = [];
function QuestionAttachments({
  images,
  onRemove,
}: {
  images: ContextItem[];
  onRemove?: (id: string) => void;
}) {
  const presence = usePresence(images, (image) => image.id);
  if (!presence.entries.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
      {presence.entries.map(({ key, value: image, present }) => (
        <AttachmentPreview
          key={key}
          id={image.id}
          name={image.label}
          type={image.imageMimeType}
          imageData={image.imageData}
          imageMimeType={image.imageMimeType}
          variant="thumbnail"
          onRemove={onRemove}
          present={present}
          onExit={() => presence.remove(key)}
        />
      ))}
    </div>
  );
}

function WizardSurface({
  state,
  root,
  present,
  onExit,
  children,
}: {
  state: string;
  root: RefObject<HTMLDivElement | null>;
  present: boolean;
  onExit: () => void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const expanded = state === 'expanded';
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    if (present) {
      for (const property of ['position', 'width', 'left', 'top'])
        node.style.removeProperty(property);
      const measure = () => {
        bounds.current = node.getBoundingClientRect();
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    const previous = bounds.current ?? node.getBoundingClientRect();
    const origin = root.current?.getBoundingClientRect();
    Object.assign(node.style, {
      position: 'absolute',
      width: `${previous.width}px`,
      left: `${previous.left - (origin?.left ?? previous.left)}px`,
      top: `${previous.top - (origin?.top ?? previous.top)}px`,
    });
  }, [present, root]);
  const transition = useMemo(
    () =>
      (node: HTMLElement) =>
      ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
        direction === 'in'
          ? springIn(node, { tier: 'moderate', y: expanded ? 8 : 4, scale: expanded ? 0.96 : 0.98 })
          : crispOut(node, { tier: 'moderate', y: 8, scale: 0.98 }),
    [expanded],
  );
  usePresenceTransition(surface, present, onExit, transition);
  return (
    <div
      ref={surface}
      inert={!present}
      aria-hidden={!present || undefined}
      data-question-state={state}
      className={
        expanded
          ? 'w-full origin-bottom'
          : 'flex w-full min-w-0 items-center rounded-(--radius-large) border border-border bg-card'
      }
    >
      {children}
    </div>
  );
}

export default QuestionWizard;
