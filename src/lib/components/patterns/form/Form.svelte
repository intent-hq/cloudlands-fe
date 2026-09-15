<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLFormAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';

  type KeyPolicy = 'submit' | 'ignore';

  interface Props extends Omit<HTMLFormAttributes, 'onsubmit'> {
    children: Snippet;
    onSubmit: (event: SubmitEvent) => void | Promise<void>;
    busy?: boolean;
    enterKey?: KeyPolicy;
    modEnter?: KeyPolicy;
    class?: string;
  }

  let {
    children,
    onSubmit,
    busy = false,
    enterKey = 'submit',
    modEnter = 'submit',
    class: className,
    ...restProps
  }: Props = $props();

  let form: HTMLFormElement;
  let submitting = $state(false);
  const isBusy = $derived(busy || submitting);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (isBusy) return;
    submitting = true;
    try {
      await onSubmit(event);
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented || isBusy) return;
    const target = event.target as HTMLElement;
    const multiline = target instanceof HTMLTextAreaElement || target.isContentEditable;
    const modified = event.metaKey || event.ctrlKey;
    const shouldSubmit = modified ? modEnter === 'submit' : !multiline && enterKey === 'submit';
    if (shouldSubmit) {
      event.preventDefault();
      form.requestSubmit();
    } else if (!multiline || modified) {
      event.preventDefault();
    }
  }
</script>

<form
  bind:this={form}
  data-slot="form"
  aria-busy={isBusy || undefined}
  class={cn('grid gap-4', className)}
  onsubmit={handleSubmit}
  onkeydown={handleKeydown}
  {...restProps}
>
  <fieldset class="contents" disabled={isBusy} aria-busy={isBusy || undefined}>
    {@render children()}
  </fieldset>
</form>
