<script lang="ts" module>
  import { createRawSnippet, type ComponentProps } from 'svelte';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import ButtonDefinitionComponent from './button.svelte';

  function label(text: string) {
    return createRawSnippet(() => ({ render: () => text }));
  }

  export const preview = definePreview<ComponentProps<typeof ButtonDefinitionComponent>>({
    id: 'button',
    title: 'Button',
    defaultState: 'default',
    states: {
      default: { props: { children: label('Continue') } },
      loading: { props: { children: label('Saving'), loading: true } },
      disabled: { props: { children: label('Unavailable'), disabled: true } },
      destructive: {
        props: { children: label('Delete workspace'), variant: 'destructive' },
      },
    },
  });
</script>

<script lang="ts">
  import Button from './button.svelte';

  let props: ComponentProps<typeof Button> = $props();
</script>

<Button {...props} />
