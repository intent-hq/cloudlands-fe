<script lang="ts">
  import { cn } from '$lib/utils';
  import { Accordion as AccordionPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'value'> {
    type?: 'single' | 'multiple';
    value?: string | string[];
    onValueChange?: ((value: string) => void) | ((value: string[]) => void);
    disabled?: boolean;
    loop?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    type = 'single',
    value = $bindable(),
    onValueChange,
    disabled = false,
    loop = true,
    class: className,
    children,
    ...restProps
  }: Props = $props();

  function handleSingleValueChange(next: string) {
    value = next;
    (onValueChange as ((value: string) => void) | undefined)?.(next);
  }

  function handleMultipleValueChange(next: string[]) {
    value = next;
    (onValueChange as ((value: string[]) => void) | undefined)?.(next);
  }
</script>

{#if type === 'multiple'}
  <AccordionPrimitive.Root
    type="multiple"
    value={Array.isArray(value) ? value : []}
    onValueChange={handleMultipleValueChange}
    {disabled}
    {loop}
    class={cn('w-full', className)}
    {...restProps as any}
  >
    {@render children?.()}
  </AccordionPrimitive.Root>
{:else}
  <AccordionPrimitive.Root
    type="single"
    value={typeof value === 'string' ? value : ''}
    onValueChange={handleSingleValueChange}
    {disabled}
    {loop}
    class={cn('w-full', className)}
    {...restProps as any}
  >
    {@render children?.()}
  </AccordionPrimitive.Root>
{/if}
