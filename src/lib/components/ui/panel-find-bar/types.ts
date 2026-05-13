export type PanelFindBarLayout = 'floating' | 'inline';

export type PanelFindBarResultFormat = 'slash' | 'of';

export type PanelFindBarResultVariant = 'muted' | 'destructive';

export interface PanelFindBarProps {
  query?: string;
  inputRef?: HTMLInputElement | null;
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
  class?: string;
  inputWrapperClass?: string;
  inputClass?: string;
  actionsClass?: string;
  onPrevious?: (query: string, event: MouseEvent | KeyboardEvent) => void;
  onNext?: (query: string, event: MouseEvent | KeyboardEvent) => void;
  onClose?: (event: MouseEvent | KeyboardEvent) => void;
  onQueryChange?: (query: string, event: Event) => void;
  onInput?: (event: Event) => void;
  onKeydown?: (event: KeyboardEvent) => void;
}