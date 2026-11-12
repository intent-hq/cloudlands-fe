<script lang="ts" module>
  import { createRawSnippet, type ComponentProps } from 'svelte';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import ButtonDefinitionComponent from './button.svelte';

  type PreviewProps = ComponentProps<typeof ButtonDefinitionComponent> & {
    surfaceGeometry?: boolean;
  };

  function label(text: string) {
    return createRawSnippet(() => ({ render: () => text }));
  }

  const arrowIcon = createRawSnippet(() => ({
    render: () =>
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>',
  }));

  export const preview = definePreview<PreviewProps>({
    id: 'button',
    title: 'Button',
    defaultState: 'default',
    states: {
      default: { props: { children: label('Continue') } },
      primary: { props: { children: label('Continue'), variant: 'primary' } },
      secondary: { props: { children: label('Continue'), variant: 'secondary' } },
      ghost: { props: { children: label('Continue'), variant: 'ghost' } },
      outline: { props: { children: label('Continue'), variant: 'outline' } },
      active: { props: { active: true, children: label('Open menu'), variant: 'outline' } },
      'surface-geometry': { props: { surfaceGeometry: true } },
      'icon-weight': {
        props: { children: label('Next'), leadingIcon: arrowIcon, variant: 'primary' },
      },
      loading: { props: { children: label('Saving'), loading: true } },
      disabled: { props: { children: label('Unavailable'), disabled: true } },
      destructive: {
        props: { children: label('Delete workspace'), variant: 'destructive' },
      },
    },
  });
</script>

<script lang="ts">
  import { ButtonGroup } from '$lib/components/ui/button-group';
  import Button from './button.svelte';

  let { surfaceGeometry = false, ...props }: PreviewProps = $props();
  let clicks = $state(0);
  const shapes = [
    { label: 'Default', class: '' },
    { label: 'Card', class: 'rounded-xl' },
    { label: 'Pill', class: 'rounded-full' },
    { label: 'Square', class: 'rounded-none' },
    { label: 'Mixed corners', class: 'rounded-tl-none rounded-br-none' },
    { label: 'Leading half', class: 'rounded-r-none border-r-0' },
    { label: 'Trailing half', class: 'rounded-l-none border-l-0' },
    { label: 'Borderless', class: 'border-0' },
    { label: 'Thick border', class: 'border-2' },
  ];
</script>

{#if surfaceGeometry}
  <div class="grid w-full max-w-2xl gap-4">
    <div class="grid grid-cols-3 items-center gap-3">
      <span></span>
      <span class="type-caption text-muted-foreground">Idle / hover</span>
      <span class="type-caption text-muted-foreground">Selected</span>
      {#each shapes as shape (shape.label)}
        <span class="type-caption">{shape.label}</span>
        <Button
          variant="outline"
          class="min-w-0 {shape.class}"
          aria-label={`${shape.label} idle`}
          onclick={() => (clicks += 1)}>Action</Button
        >
        <Button
          variant="outline"
          active
          class="min-w-0 {shape.class}"
          aria-label={`${shape.label} selected`}
          onclick={() => (clicks += 1)}>Action</Button
        >
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <ButtonGroup aria-label="Grouped actions">
        <Button variant="outline" onclick={() => (clicks += 1)}>Copy</Button>
        <Button variant="outline" active onclick={() => (clicks += 1)}>Share</Button>
      </ButtonGroup>
      <Button variant="primary" onclick={() => (clicks += 1)}>Primary</Button>
      <Button variant="secondary" onclick={() => (clicks += 1)}>Secondary</Button>
      <Button variant="ghost" active onclick={() => (clicks += 1)}>Ghost</Button>
      <Button variant="outline" disabled onclick={() => (clicks += 1)}>Disabled</Button>
      <Button variant="outline" loading onclick={() => (clicks += 1)}>Loading</Button>
      <Button variant="outline" active data-state="open" onclick={() => (clicks += 1)}
        >Open trigger</Button
      >
    </div>
    <output class="type-caption text-muted-foreground" aria-live="polite">Clicks: {clicks}</output>
  </div>
{:else}
  <Button {...props} />
{/if}
