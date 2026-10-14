import { useEffect, useRef, useState } from 'react';
import { PanelFindBar } from '@/components/ui/panel-find-bar';
import { m } from '$shared/paraglide/messages.js';

interface TerminalSearchBarProps {
  isOpen: boolean;
  hasMatches?: boolean;
  currentMatchIndex?: number;
  totalMatches?: number;
  focusTrigger?: number;
  initialQuery?: string;
  onFindNext: (query: string) => void;
  onFindPrevious: (query: string) => void;
  onClose: () => void;
}

export function TerminalSearchBar({
  isOpen,
  hasMatches = true,
  currentMatchIndex = -1,
  totalMatches = 0,
  focusTrigger = 0,
  initialQuery = '',
  onFindNext,
  onFindPrevious,
  onClose,
}: TerminalSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const lastAppliedSeedTrigger = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isOpen || lastAppliedSeedTrigger.current === focusTrigger) return;
    lastAppliedSeedTrigger.current = focusTrigger;
    const query = initialQuery.trim();
    if (!query) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Preserve source autofocus before seed publication and callback-visible DOM ordering.
    setSearchQuery(query);
    onFindNext(query);
  }, [isOpen, focusTrigger, initialQuery, onFindNext]);

  const resultText = !searchQuery
    ? null
    : hasMatches === false
      ? m.terminal_searchBar_noResults_label()
      : totalMatches > 0
        ? m.ui_panelFindBar_matchOf_label({
            current: currentMatchIndex + 1,
            total: totalMatches,
          })
        : null;

  if (!isOpen) return null;

  return (
    <PanelFindBar
      query={searchQuery}
      onQueryChange={setSearchQuery}
      placeholder={m.terminal_searchBar_find_placeholder()}
      autofocus
      currentMatchIndex={currentMatchIndex}
      totalMatches={totalMatches}
      resultText={resultText}
      emptyResultText={m.terminal_searchBar_noResults_label()}
      resultFormat="of"
      disableNavigationWhenNoMatches={false}
      className="top-0 right-0 z-10 rounded-none border-0 border-l border-b border-border bg-background/90 px-2 py-1"
      inputWrapperClass="rounded-none"
      inputClass="w-[140px] text-[0.8125rem]"
      onPrevious={() => onFindPrevious(searchQuery)}
      onNext={() => onFindNext(searchQuery)}
      onClose={onClose}
    />
  );
}
