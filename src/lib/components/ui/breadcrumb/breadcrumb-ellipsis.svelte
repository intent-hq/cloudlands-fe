<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { m } from '$shared/paraglide/messages.js';

  type Props = HTMLAttributes<HTMLSpanElement>;

  let { class: className, ...restProps }: Props = $props();
</script>

<span
  role="presentation"
  aria-hidden="true"
  class={cn('flex h-9 w-9 items-center justify-center', className)}
  {...restProps}
>
  <Fa icon={faEllipsis} size="1x" class="h-4 w-4" />
  <span class="sr-only">{m.ui_breadcrumb_more_label()}</span>
</span>
