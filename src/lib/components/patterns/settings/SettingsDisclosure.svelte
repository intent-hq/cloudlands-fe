<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Accordion from '$lib/components/ui/accordion';
  import { cn } from '$lib/utils';

  let {
    label,
    children,
    class: className,
  }: { label: string; children?: Snippet; class?: string } = $props();
</script>

<Accordion.Root type="multiple" class={cn('min-w-0', className)}>
  <Accordion.Item value="content">
    <Accordion.Header>
      <Accordion.Trigger class="type-body font-medium data-[state=open]:font-medium">
        {label}
      </Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Content class="-mx-2">
      {@render children?.()}
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
