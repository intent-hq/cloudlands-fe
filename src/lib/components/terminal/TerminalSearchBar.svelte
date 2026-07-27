<script lang="ts">
  import { PanelFindBar } from '$lib/components/ui/panel-find-bar';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
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

  let {
    isOpen,
    hasMatches = true,
    currentMatchIndex = -1,
    totalMatches = 0,
    focusTrigger = 0,
    initialQuery = '',
    onFindNext,
    onFindPrevious,
    onClose,
  }: Props = $props();

  let searchQuery = $state('');
  let inputRef: HTMLInputElement | null = $state(null);

  const resultText = $derived.by(() => {
    if (!searchQuery) return null;
    if (hasMatches === false) return m.terminal_searchBar_noResults_label();
    if (totalMatches > 0)
      return m.ui_panelFindBar_matchOf_label({
        current: currentMatchIndex + 1,
        total: totalMatches,
      });
    return null;
  });

  let lastAppliedSeedTrigger: number | undefined = $state(undefined);

  $effect(() => {
    if (!isOpen || lastAppliedSeedTrigger === focusTrigger) return;
    lastAppliedSeedTrigger = focusTrigger;

    const query = initialQuery.trim();
    if (!query) return;

    searchQuery = query;
    onFindNext(query);
  });
</script>

{#if isOpen}
  <PanelFindBar
    bind:query={searchQuery}
    bind:inputRef={inputRef}
    placeholder={m.terminal_searchBar_find_placeholder()}
    autofocus
    {focusTrigger}
    currentMatchIndex={currentMatchIndex}
    totalMatches={totalMatches}
    {resultText}
    emptyResultText={m.terminal_searchBar_noResults_label()}
    resultFormat="of"
    disableNavigationWhenNoMatches={false}
    class="top-0 right-0 z-10 rounded-none border-0 border-l border-b border-border bg-background/90 px-2 py-1"
    inputWrapperClass="rounded-none"
    inputClass="w-[140px] text-[0.8125rem]"
    onPrevious={() => onFindPrevious(searchQuery)}
    onNext={() => onFindNext(searchQuery)}
    onClose={onClose}
  />
{/if}
