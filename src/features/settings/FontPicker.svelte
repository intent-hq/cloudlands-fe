<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Combobox } from '$lib/components/ui/combobox';
  import * as Popover from '$lib/components/ui/popover';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import type { FontOption } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { m } from '$shared/paraglide/messages.js';

  let {
    value,
    options,
    fontFamily,
    ariaLabelledby,
    ariaDescribedby,
    open = $bindable(false),
    onchange,
  }: {
    value: string;
    options: FontOption[];
    fontFamily: string;
    ariaLabelledby?: string;
    ariaDescribedby?: string;
    open?: boolean;
    onchange: (value: string) => void;
  } = $props();

  let searchInput = $state<HTMLInputElement | null>(null);
  const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? value);
  const searchOptions = $derived(options.map((option) => ({ ...option, data: option })));

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if (event.isComposing) return false;
      open = false;
    });
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        aria-label={ariaLabelledby ? undefined : m.settings_font_code_label()}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        class="w-full min-w-0 justify-between gap-2"
      >
        <span class="truncate" style:font-family={fontFamily}>{selectedLabel}</span>
        <Fa icon={faChevronDown} class="size-4! shrink-0 text-muted-foreground" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    aria-label={m.settings_font_code_label()}
    preventScroll={false}
    class="flex min-h-0 w-64 flex-col overflow-hidden p-0"
    style="max-width: calc(100vw - var(--space-4)); max-height: min(300px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      searchInput?.focus();
    }}
  >
    <Combobox
      {value}
      options={searchOptions}
      {open}
      bind:inputRef={searchInput}
      ariaLabel={m.settings_fonts_search_placeholder()}
      searchPlaceholder={m.settings_fonts_search_placeholder()}
      emptyText={m.settings_fonts_noResults_message()}
      staticPosition
      inputVariant="search"
      class="flex min-h-0 flex-1 flex-col px-2 pt-1"
      viewportClass="min-h-0 max-h-none flex-1 p-0 pb-2"
      contentClass="flex min-h-0 max-h-none flex-1 flex-col border-0 shadow-none"
      oncommit={(_, option) => {
        onchange(option.value);
        open = false;
      }}
      onopenchange={(next) => {
        if (!next) open = false;
      }}
    >
      {#snippet optionLabel(option)}
        <span style:font-family={(option.data as FontOption).fontFamily}>{option.label}</span>
      {/snippet}
    </Combobox>
  </Popover.Content>
</Popover.Root>
