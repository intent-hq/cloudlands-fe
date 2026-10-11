import type { Ref, KeyboardEvent, MouseEvent, FormEvent, CompositionEvent } from 'react';

type PanelFindBarLayout = 'floating' | 'inline';

export type PanelFindBarResultFormat = 'slash' | 'of';

type PanelFindBarResultVariant = 'muted' | 'destructive';

export interface PanelFindBarProps {
  query?: string;
  inputRef?: Ref<HTMLInputElement>;
  ref?: Ref<PanelFindBarHandle>;
  placeholder?: string;
  disabled?: boolean;
  inputDisabled?: boolean;
  navigationDisabled?: boolean;
  closeDisabled?: boolean;
  disableNavigationWhenNoMatches?: boolean;
  autofocus?: boolean;
  selectOnFocus?: boolean;
  focusTrigger?: number;
  currentMatchIndex?: number;
  totalMatches?: number;
  resultText?: string | null;
  emptyResultText?: string;
  showResultText?: boolean;
  showResultWhenQueryEmpty?: boolean;
  resultFormat?: PanelFindBarResultFormat;
  resultVariant?: PanelFindBarResultVariant;
  searchAriaLabel?: string;
  previousLabel?: string;
  previousShortcutLabel?: string;
  previousKeyShortcuts?: string;
  previousTitle?: string;
  nextLabel?: string;
  nextShortcutLabel?: string;
  nextKeyShortcuts?: string;
  nextTitle?: string;
  closeLabel?: string;
  closeShortcutLabel?: string;
  closeKeyShortcuts?: string;
  closeTitle?: string;
  layout?: PanelFindBarLayout;
  className?: string;
  inputWrapperClass?: string;
  inputClass?: string;
  actionsClass?: string;
  onPrevious?: (query: string, event: MouseEvent | KeyboardEvent) => void;
  onNext?: (query: string, event: MouseEvent | KeyboardEvent) => void;
  onClose?: (event: MouseEvent | KeyboardEvent) => void;
  onQueryChange?: (query: string, event: FormEvent<HTMLInputElement>) => void;
  onInput?: (event: FormEvent<HTMLInputElement>) => void;
  onKeydown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: (event: CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd?: (event: CompositionEvent<HTMLInputElement>) => void;
}

export interface PanelFindBarHandle {
  focus(): void;
  blur(): void;
  select(): void;
}
