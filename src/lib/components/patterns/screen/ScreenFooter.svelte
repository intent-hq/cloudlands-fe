<script lang="ts">
  import FormActions from '$lib/components/patterns/form/FormActions.svelte';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
    destructive?: Snippet;
    secondary?: Snippet;
    primary: Snippet;
    hint?: string;
    class?: string;
  }

  let { destructive, secondary, primary, hint, class: className, ...restProps }: Props = $props();
</script>

<footer
  data-slot="screen-footer"
  class={cn('shrink-0 border-t border-border px-5 py-3', className)}
  {...restProps}
>
  <FormActions {destructive} {secondary} {primary} {hint} />
</footer>
