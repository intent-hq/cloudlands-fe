<script lang="ts">
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import {
    textEntryControlClasses,
    textEntryFocusResetClasses,
    textEntryHeight,
  } from '../text-entry';
  import { cn, type WithElementRef } from '$lib/utils.js';

  type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;
  type SharedProps = Omit<HTMLInputAttributes, 'size' | 'type'> & {
    size?: UiSize | number;
    noFocusStyle?: boolean;
    message?: string;
    error?: string;
    messageId?: string;
  };

  type Props = WithElementRef<
    SharedProps & ({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
  >;

  const uid = $props.id();
  const contextSize = useSize();

  let {
    ref = $bindable(),
    id,
    value = $bindable(),
    type,
    size,
    files = $bindable(),
    noFocusStyle = false,
    message,
    error,
    messageId = `${uid}-message`,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    class: className,
    'data-slot': dataSlot = 'input',
    ...restProps
  }: Props = $props();

  const resolvedSize = $derived(typeof size === 'string' ? size : contextSize);
  const nativeSize = $derived(typeof size === 'number' ? size : undefined);
  const visibleMessage = $derived(error ?? message);
  const describedBy = $derived(
    [ariaDescribedBy, visibleMessage ? messageId : undefined].filter(Boolean).join(' ') ||
      undefined,
  );
  const invalid = $derived(error ? true : ariaInvalid);

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
    {id}
    data-slot={dataSlot}
    data-size={resolvedSize}
    class={cn(
      'type-caption text-foreground selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex w-full min-w-0 rounded-(--radius-medium) border px-3 file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-foreground',
      textEntryControlClasses,
      textEntryHeight(resolvedSize),
      noFocusStyle && textEntryFocusResetClasses,
      className,
    )}
    type="file"
    size={nativeSize}
    aria-describedby={describedBy}
    aria-invalid={invalid}
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    {id}
    data-slot={dataSlot}
    data-size={resolvedSize}
    class={cn(
      'type-caption text-foreground selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex w-full min-w-0 rounded-(--radius-medium) border px-3 py-1',
      textEntryControlClasses,
      textEntryHeight(resolvedSize),
      noFocusStyle && textEntryFocusResetClasses,
      className,
    )}
    {type}
    size={nativeSize}
    aria-describedby={describedBy}
    aria-invalid={invalid}
    bind:value
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    {...restProps}
  />
{/if}

{#if visibleMessage}
  <InputMessage id={messageId} tone={error ? 'error' : 'helper'}>{visibleMessage}</InputMessage>
{/if}
