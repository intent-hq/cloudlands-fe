<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Accordion from '$lib/components/ui/accordion';
  import { cn } from '$lib/utils';

  let {
    label,
    children,
    class: className,
  }: { label: string; children?: Snippet; class?: string } = $props();
  let value = $state<string[]>([]);
</script>

<Accordion.Root type="multiple" bind:value class={cn('min-w-0', className)}>
  <Accordion.Item value="content">
    <Accordion.Header>
      <Accordion.Trigger class="type-body font-medium data-[state=open]:font-medium">
        {label}
      </Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Content class="-mx-2">
      <div hidden={!value.includes('content')}>
        {@render children?.()}
      </div>
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
