<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    state?: 'default' | 'typed' | 'disabled' | 'with-action' | 'picker';
  }

  export const preview = definePreview<Props>({
    id: 'menu-search',
    title: 'Menu search',
    defaultState: 'default',
    states: {
      default: { props: { state: 'default' } },
      typed: { props: { state: 'typed' } },
      disabled: { props: { state: 'disabled' } },
      'with-action': { props: { state: 'with-action' } },
      picker: { props: { state: 'picker' } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Combobox } from '$lib/components/ui/combobox';
  import { Input } from '$lib/components/ui/input';
  import { faArrowsRotate } from '$lib/icons/phosphor-icons';
  import Fa from 'svelte-fa';

  let { state: scenario = 'default' }: Props = $props();
  let query = $state(untrack(() => (scenario === 'typed' ? 'feature/' : '')));
  let picked = $state('main');
  const branches = [
    { value: 'main', label: 'main' },
    { value: 'feature/menu-search', label: 'feature/menu-search' },
    { value: 'fix/focus-return', label: 'fix/focus-return' },
  ];
</script>

<!-- i18n-ignore (design-system preview fixture copy) -->
<section class="grid gap-4 bg-background p-4" data-testid="menu-search-fixture">
  <div
    class="w-80 rounded-xl border border-border bg-popover px-2 pt-1 pb-2 text-popover-foreground"
  >
    {#if scenario === 'picker'}
      <Combobox
        value={picked}
        options={branches}
        open
        staticPosition
        ariaLabel="Branch"
        inputVariant="search"
        rowClass="px-3"
        onchange={(value) => (picked = String(value))}
      />
    {:else if scenario === 'with-action'}
      <div class="flex items-center gap-1">
        <Input variant="search" aria-label="Search branches" placeholder="Search branches" />
        <Button variant="ghost" size="icon-sm" iconOnly aria-label="Refresh branches">
          <Fa icon={faArrowsRotate} class="size-3.5" />
        </Button>
      </div>
    {:else}
      <Input
        variant="search"
        aria-label="Search"
        placeholder="Search"
        disabled={scenario === 'disabled'}
        bind:value={query}
      />
    {/if}
  </div>
</section>
