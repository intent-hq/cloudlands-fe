<script lang="ts">
  import { setContext, type Snippet } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';

  interface SelectItemData {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    value: string;
    open?: boolean;
    items?: SelectItemData[];
    disabled?: boolean;
    invalid?: boolean;
    required?: boolean;
    name?: string;
    loop?: boolean;
    onchange?: (value: string) => void;
    onopenchange?: (open: boolean) => void;
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    open = $bindable(false),
    items = [],
    disabled = false,
    invalid = false,
    required = false,
    name,
    loop = true,
    onchange,
    onopenchange,
    children,
  }: Props = $props();

  setContext('canonical-select', {
    get value() {
      return value;
    },
    get displayValue() {
      return items.find((item) => item.value === value)?.label ?? value;
    },
    get invalid() {
      return invalid;
    },
    get open() {
      return open;
    },
    set open(nextOpen: boolean) {
      open = nextOpen;
    },
  });
</script>

<div class="relative min-w-0 w-full">
  <SelectPrimitive.Root
    type="single"
    bind:value
    bind:open
    {items}
    {disabled}
    {required}
    {name}
    {loop}
    onValueChange={onchange}
    onOpenChange={onopenchange}
  >
    {@render children?.()}
  </SelectPrimitive.Root>
</div>
