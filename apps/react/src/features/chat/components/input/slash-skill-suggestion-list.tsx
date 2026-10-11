/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source composite listbox, button options and block status surfaces. */
// Source: src/lib/components/chat/input/SlashSkillSuggestionList.svelte.
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { menuItem } from '@/components/ui/menu/menu-recipes';
import { cn } from '@/lib/utils';
import type { SkillInfo } from '../../../../../../../src/store/renderer/slices/skills/skills-types';
import { m } from '$shared/paraglide/messages.js';
import './slash-skill-suggestion-list.css';

export interface SlashSkillSuggestionListHandle {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean;
}

export interface SlashSkillSuggestionListProps {
  items?: readonly SkillInfo[];
  loading?: boolean;
  error?: string | null;
  listboxId?: string;
  onSelect: (skill: SkillInfo) => void;
  onDismiss?: () => void;
  onRetry?: () => void;
  onActiveOptionChange?: (optionId: string | undefined) => void;
  ref?: Ref<SlashSkillSuggestionListHandle>;
}

const emptyItems: readonly SkillInfo[] = [];

export function SlashSkillSuggestionList({
  items = emptyItems,
  loading = false,
  error = null,
  listboxId,
  onSelect,
  onDismiss,
  onRetry,
  onActiveOptionChange,
  ref,
}: SlashSkillSuggestionListProps) {
  const componentId = useId();
  const listElement = useRef<HTMLDivElement>(null);
  const scrollRequested = useRef(false);
  const [selection, setSelection] = useState({ items, loading, error, index: 0 });
  let selectedIndex = selection.index;
  if (selection.items !== items || selection.loading !== loading || selection.error !== error) {
    selectedIndex = 0;
    setSelection({ items, loading, error, index: 0 });
  }

  function optionId(item: SkillInfo) {
    return `${componentId}-option-${encodeURIComponent(`${item.name}:${item.location}`)}`;
  }
  const selectedOptionId =
    !loading && !error && items[selectedIndex] ? optionId(items[selectedIndex]) : undefined;

  useEffect(() => {
    onActiveOptionChange?.(selectedOptionId);
  }, [onActiveOptionChange, selectedOptionId]);

  useLayoutEffect(() => {
    if (!scrollRequested.current) return;
    scrollRequested.current = false;
    listElement.current
      ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  function moveSelection(delta: number) {
    if (items.length === 0) return;
    scrollRequested.current = true;
    setSelection((current) => ({
      ...current,
      index: (current.index + delta + items.length) % items.length,
    }));
  }

  function selectItem(index: number) {
    const item = items[index];
    if (item && !loading && !error) onSelect(item);
  }

  function handleKeyDown(event: KeyboardEvent | ReactKeyboardEvent<HTMLDivElement>): boolean {
    if ((loading || error) && event.key !== 'Escape') return false;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (items.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        moveSelection(event.key === 'ArrowUp' ? -1 : 1);
        return true;
      case 'Enter':
        if (items.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        selectItem(selectedIndex);
        return true;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onDismiss?.();
        return true;
      default:
        return false;
    }
  }

  useImperativeHandle(ref, () => ({ onKeyDown: ({ event }) => handleKeyDown(event) }));

  return (
    <div className="slash-skill-suggestion-list w-full max-w-72 overflow-hidden rounded-(--radius-medium) border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay)">
      {loading ? (
        <div className="slash-skill-state" role="status" aria-live="polite">
          {m.chat_slashSkillSuggestionList_loading_label()}
        </div>
      ) : error ? (
        <div className="slash-skill-state" role="alert">
          {m.chat_slashSkillSuggestionList_loadFailed_label()}
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onRetry}
            >
              {m.ui_errorToast_retry_label()}
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="slash-skill-state" role="status">
          {m.chat_slashSkillSuggestionList_noResults_label()}
        </div>
      ) : (
        <div
          id={listboxId ?? `${componentId}-listbox`}
          ref={listElement}
          className="slash-skill-options"
          role="listbox"
          aria-label={m.chat_slashSkillSuggestionList_ariaLabel()}
          aria-activedescendant={selectedOptionId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {items.map((item, index) => (
            <Tooltip
              key={`${item.name}:${item.location}`}
              content={item.description}
              side="right"
              align="start"
              size="sm"
              className="w-full"
            >
              <Button
                type="button"
                id={optionId(item)}
                variant="ghost"
                size="sm"
                labelClass="type-body"
                className={cn(
                  menuItem(),
                  'slash-skill-option h-auto rounded-none border-0 bg-transparent py-1.5 text-inherit shadow-none hover:border-0 hover:text-inherit focus-visible:border-0 active:border-0',
                  selectedIndex === index && 'active',
                )}
                role="option"
                tabIndex={-1}
                aria-label={item.name}
                aria-selected={selectedIndex === index}
                onPointerEnter={() => setSelection((current) => ({ ...current, index }))}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectItem(index)}
              >
                <span className="type-body">{item.name}</span>
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
