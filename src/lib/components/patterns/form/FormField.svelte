<script lang="ts">
  import type { Snippet } from 'svelte';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Label } from '$lib/components/ui/label';
  import { cn } from '$lib/utils.js';
  import type { FormControlProps } from './types';

  interface Props {
    label: string;
    control: Snippet<[FormControlProps]>;
    id?: string;
    name?: string;
    description?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    class?: string;
  }

  const uid = $props.id();
  let {
    label,
    control,
    id = `${uid}-control`,
    name,
    description,
    error,
    required = false,
    disabled = false,
    class: className,
  }: Props = $props();

  const descriptionId = $derived(description ? `${id}-description` : undefined);
  const errorId = $derived(error ? `${id}-error` : undefined);
  const describedBy = $derived([descriptionId, errorId].filter(Boolean).join(' ') || undefined);
  const controlProps = $derived<FormControlProps>({
    id,
    name,
    required,
    disabled,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  });
</script>

<div
  data-slot="form-field"
  data-invalid={error ? true : undefined}
  data-disabled={disabled ? true : undefined}
  class={cn('group grid min-w-0 gap-1.5', className)}
>
  <Label for={id} invalid={Boolean(error)}>{label}</Label>
  {@render control(controlProps)}
  {#if description}
    <InputMessage id={descriptionId}>{description}</InputMessage>
  {/if}
  {#if error}
    <InputMessage id={errorId} tone="error">{error}</InputMessage>
  {/if}
</div>
