<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, 'type'> &
      (
        | { type: 'file'; files?: FileList; noFocusStyle?: boolean }
        | { type?: InputType; files?: undefined; noFocusStyle?: boolean }
      )
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
      'type-body border-border bg-card text-foreground selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground/70 flex h-(--control-height-medium) w-full min-w-0 rounded-(--radius-medium) border px-3 shadow-none outline-none transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-input file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-foreground disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border motion-reduce:transition-none',
      noFocusStyle
        ? 'focus-visible:outline-none focus-visible:ring-0'
        : 'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0',
      'aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
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
      'type-body border-border bg-card text-foreground selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground/70 flex h-(--control-height-medium) w-full min-w-0 rounded-(--radius-medium) border px-3 py-1 shadow-none outline-none transition-[border-color,background-color,box-shadow] duration-(--motion-fast) hover:border-input read-only:bg-muted/30 read-only:text-muted-foreground read-only:hover:border-border disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border motion-reduce:transition-none',
      noFocusStyle
        ? 'focus-visible:outline-none focus-visible:ring-0'
        : 'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0',
      'aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
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
