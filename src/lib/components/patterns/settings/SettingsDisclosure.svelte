<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Accordion from '$lib/components/ui/accordion';
  import { cn } from '$lib/utils';

  let {
    label,
    children,
    flush = false,
    muted = false,
    class: className,
  }: {
    label: string;
    children?: Snippet;
    /** Align the label's text with the content while preserving its padded hit area. */
    flush?: boolean;
    /** Keep secondary controls quiet in both disclosure states. */
    muted?: boolean;
    class?: string;
  } = $props();
  let value = $state<string[]>([]);
</script>

<Accordion.Root type="multiple" bind:value class={cn('min-w-0', className)}>
  <Accordion.Item value="content">
    <Accordion.Header>
      <Accordion.Trigger
        class={cn(
          'type-body font-medium data-[state=open]:font-medium',
          flush && '-ml-2',
          muted &&
            'font-normal text-muted-foreground data-[state=open]:font-normal data-[state=open]:text-muted-foreground',
        )}
      >
        {label}
      </Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Content class={flush ? '-ml-2' : '-mx-2'}>
      <div hidden={!value.includes('content')}>
        {@render children?.()}
      </div>
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
