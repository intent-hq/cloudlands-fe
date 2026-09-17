<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'text-entry-focus',
    title: 'Caret-only text entry focus',
    defaultState: 'default',
    states: { default: { props: {} } },
  });
</script>

<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Textarea as SettingsTextarea } from '$lib/components/patterns/settings/custom-controls';

  let input = $state('Workspace');
  let notes = $state('Draft notes');
</script>

<section class="grid gap-3 bg-sidebar p-4" data-testid="text-entry-focus-fixture">
  <Button>Start keyboard navigation</Button>
  <Input aria-label="Workspace name" bind:value={input} />
  <Textarea aria-label="Workspace notes" bind:value={notes} rows={2} />
  <Input aria-label="Invalid name" error="A name is required" />
  <Textarea aria-label="Invalid notes" error="Notes are required" rows={2} />
  <Input aria-label="Disabled name" disabled value="Unavailable" />
  <Textarea aria-label="Read-only notes" readonly value="Managed notes" rows={2} />
  <SettingsTextarea aria-label="Settings notes" value="Setting draft" rows={2} />
  <Input aria-label="Composite field" noFocusStyle value="Quiet composite" />
  <Input aria-label="Choose file" type="file" />
  <output class="sr-only" data-testid="text-entry-values">{JSON.stringify({ input, notes })}</output
  >
</section>
