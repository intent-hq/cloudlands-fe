import type { UiSize } from '$lib/components/ui/size-context';
import type { Snippet } from 'svelte';

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
  skipped?: boolean;
}

export interface AskUserQuestionsProps {
  questions: AskUserQuestion[];
  currentIndex?: number;
  defaultCurrentIndex?: number;
  onCurrentIndexChange?: (index: number) => void;
  answers?: Record<string, AskUserAnswer>;
  defaultAnswers?: Record<string, AskUserAnswer>;
  onAnswersChange?: (answers: Record<string, AskUserAnswer>) => void;
  onComplete?: (answers: Record<string, AskUserAnswer>) => void;
  onSkip?: (questionId: string, currentIndex: number) => void;
  skipLabel?: string;
  onBack?: (currentIndex: number) => void;
  showBack?: boolean;
  backLabel?: string;
  headerActions?: Snippet;
  /** Leading actions in the bottom row, before question navigation. */
  footerActions?: Snippet;
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
  class?: string;
  id?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  onkeydown?: (event: KeyboardEvent) => void;
}
