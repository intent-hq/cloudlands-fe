<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, 'type'> &
      ({ type: 'file'; files?: FileList, noFocusStyle?: boolean } | { type?: InputType; files?: undefined, noFocusStyle?: boolean })
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    type,
    files = $bindable(),
    noFocusStyle = false,
    class: className,
    'data-slot': dataSlot = 'input',
    ...restProps
  }: Props = $props();

  export function focus() {
    ref?.focus();
  }
  export function blur() {
    ref?.blur();
  }
  export function select() {
    (ref as HTMLInputElement | null)?.select();
  }
  export function setSelectionRange(
    start: number,
    end: number,
    direction?: 'forward' | 'backward' | 'none',
  ) {
    (ref as HTMLInputElement | null)?.setSelectionRange(start, end, direction);
  }
</script>

{#if type === 'file'}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'selection:bg-primary dark:bg-input/30 selection:text-primary-foreground border-input ring-offset-background placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 pt-1.5 text-sm font-medium outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      'focus:ring-0 focus:outline-0',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(
      'border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base outline-none transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      'focus:ring-0 focus:outline-0',
      noFocusStyle ? 'focus:ring-0! focus:outline-0!' : 'focus:ring-1 focus:ring-ring focus:ring-offset-1',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      className,
    )}
    {type}
    bind:value
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    {...restProps}
  />
{/if}
