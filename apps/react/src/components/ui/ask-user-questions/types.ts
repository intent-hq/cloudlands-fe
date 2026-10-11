// Source: src/lib/components/ui/ask-user-questions/types.ts. Slots and DOM events use React.
import type { UiSize } from '@/components/ui/size-context';
import type { ClipboardEvent, KeyboardEventHandler, ReactNode } from 'react';

export interface AskUserOption {
  id?: string;
  title: string;
  description?: string;
}

export interface AskUserQuestion {
  id?: string;
  header?: string;
  title: string;
  description?: string;
  options?: AskUserOption[];
  multiSelect?: boolean;
  allowOther?: boolean;
  otherPlaceholder?: string;
  otherAriaLabel?: string;
  /** Cap auto-growth in lines and allow manual vertical resizing. */
  otherAutoGrowMaxLines?: number;
  otherEnterSubmits?: boolean;
  skippable?: boolean;
  nextLabel?: string;
  layout?: 'inline' | 'stacked';
  chipPosition?: 'left' | 'right';
  freeText?: boolean;
  freeTextPlaceholder?: string;
  freeTextMultiline?: boolean;
  freeTextValidate?: (value: string) => string | null | undefined;
}

export interface AskUserAnswer {
  questionId: string;
  selectedIds: string[];
  otherText?: string;
  /** Attachment bytes and presentation remain owned by the caller. */
  hasAttachments?: boolean;
  skipped?: boolean;
}

export interface AskUserQuestionsProps {
  questions: AskUserQuestion[];
  currentIndex?: number;
  defaultCurrentIndex?: number;
  /** Includes answers written during the same interaction, before controlled props refresh. */
  onCurrentIndexChange?: (index: number, answers: Record<string, AskUserAnswer>) => void;
  answers?: Record<string, AskUserAnswer>;
  defaultAnswers?: Record<string, AskUserAnswer>;
  onAnswersChange?: (answers: Record<string, AskUserAnswer>) => void;
  onComplete?: (answers: Record<string, AskUserAnswer>) => void;
  onSkip?: (questionId: string, currentIndex: number) => void;
  skipLabel?: string;
  onBack?: (currentIndex: number) => void;
  showBack?: boolean;
  backLabel?: string;
  headerActions?: ReactNode;
  /** Leading actions in the bottom row, before question navigation. */
  footerActions?: ReactNode;
  onOtherPaste?: (event: ClipboardEvent<HTMLTextAreaElement>, questionId: string) => void;
  otherAttachments?: (questionId: string) => ReactNode;
  /** Center the heading and action groups for a focused question surface. */
  centered?: boolean;
  showCounter?: boolean;
  alwaysShowSkip?: boolean;
  showOtherSubmit?: boolean;
  exclusiveOther?: boolean;
  clearOnSkip?: boolean;
  globalKeyboardShortcuts?: boolean;
  restoreFocusOnNavigate?: boolean;
  disabled?: boolean;
  size?: UiSize;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}
