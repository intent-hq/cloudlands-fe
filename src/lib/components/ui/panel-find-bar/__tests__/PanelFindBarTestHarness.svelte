<script lang="ts">
  import PanelFindBar from '../PanelFindBar.svelte';
  import type { PanelFindBarResultFormat } from '../types';

  let {
    initialQuery = '',
    totalMatches = 3,
    currentMatchIndex = 0,
    resultText = undefined,
    resultFormat = 'slash',
    disableNavigationWhenNoMatches = true,
    navigationDisabled = false,
    disabled = false,
    inputDisabled = false,
    closeDisabled = false,
    onPrevious,
    onNext,
    onClose,
    onQueryChange,
    onInput,
  }: {
    initialQuery?: string;
    totalMatches?: number;
    currentMatchIndex?: number;
    resultText?: string | null;
    resultFormat?: PanelFindBarResultFormat;
    disableNavigationWhenNoMatches?: boolean;
    navigationDisabled?: boolean;
    disabled?: boolean;
    inputDisabled?: boolean;
    closeDisabled?: boolean;
    onPrevious?: (query: string, event: MouseEvent | KeyboardEvent) => void;
    onNext?: (query: string, event: MouseEvent | KeyboardEvent) => void;
    onClose?: (event: MouseEvent | KeyboardEvent) => void;
    onQueryChange?: (query: string, event: Event) => void;
    onInput?: (event: Event) => void;
  } = $props();

  let query = $state('');

  $effect(() => {
    query = initialQuery;
  });
</script>

<PanelFindBar
  bind:query
  searchAriaLabel="Test find"
  previousLabel="Previous match"
  nextLabel="Next match"
  closeLabel="Close find"
  layout="inline"
  {totalMatches}
  {currentMatchIndex}
  {resultText}
  {resultFormat}
  {disableNavigationWhenNoMatches}
  {navigationDisabled}
  {disabled}
  {inputDisabled}
  {closeDisabled}
  {onPrevious}
  {onNext}
  {onClose}
  {onQueryChange}
  {onInput}
/>

<span data-testid="bound-query">{query}</span>