<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { Input } from '$lib/components/ui/input';
  import { InputGroup } from '$lib/components/ui/input-group';
  import { Label } from '$lib/components/ui/label';
  import type { UiSize } from '$lib/components/ui/size-context';

  const uid = $props.id();

  let {
    value,
    label,
    'aria-label': ariaLabel,
    'data-state': state,
    disabled = false,
    size,
    message,
    error,
    onCopy,
    class: className,
    ...restProps
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    value: string;
    label?: string;
    'aria-label'?: string;
    'data-state'?: 'rest' | 'hover' | 'focus';
    disabled?: boolean;
    size?: UiSize;
    message?: string;
    error?: string;
    onCopy?: () => void;
  } = $props();

  const inputId = `${uid}-input`;
  const messageId = `${uid}-message`;
</script>

{#snippet copyAction()}
  <CopyButton
    text={value}
    {disabled}
    {onCopy}
    class="aspect-square h-full p-2 text-muted-foreground hover:text-foreground [&_[data-slot=button-surface]]:hidden"
  />
{/snippet}

<div data-slot="copy-input-field" class={className} {...restProps}>
  {#if label}
    <Label for={inputId} {size}>{label}</Label>
  {/if}
  <InputGroup
    {size}
    {disabled}
    invalid={Boolean(error)}
    {message}
    {error}
    {messageId}
    data-state={state}
    trailing={copyAction}
    class={label ? 'mt-1.5' : undefined}
  >
    <Input
      id={inputId}
      {value}
      {disabled}
      {size}
      readonly
      noFocusStyle
      aria-label={ariaLabel ?? label}
      aria-describedby={error || message ? messageId : undefined}
      aria-invalid={error ? 'true' : undefined}
      class="read-only:text-foreground"
    />
  </InputGroup>
</div>
