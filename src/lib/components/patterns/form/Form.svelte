<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLFormAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';
  import { isMultilineTextEntryTarget } from '$lib/utils/text-entry';

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

  /**
   * Inputs whose plain Enter inserts a newline. Code editors such as Monaco type
   * through the EditContext API, so their focus target is a plain element marked
   * as an ARIA multiline textbox rather than a textarea (intent-hq/intent#8068).
   * Chromium exposes `editContext` as `null` on every element, so only an attached
   * EditContext counts.
   */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented || isBusy) return;
    const target = event.target as HTMLElement;
    const multiline = isMultilineTextEntryTarget(target);
    // Native controls and composite widgets own their Enter activation, even when
    // implicit submission is disabled. Check ancestors for nested button/link content.
    const interactive = target.closest(
      'button, a[href], select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="slider"]',
    );
    if (interactive && form.contains(interactive)) return;
    if (
      target instanceof HTMLInputElement &&
      !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(target.type)
    )
      return;
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
