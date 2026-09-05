<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import Form from './Form.svelte';
  import FormActions from './FormActions.svelte';
  import FormField from './FormField.svelte';
  import FormRow from './FormRow.svelte';

  let {
    error = 'Enter a valid name.',
    busy = false,
    onSubmit = () => {},
  }: {
    error?: string;
    busy?: boolean;
    onSubmit?: (event: SubmitEvent) => void | Promise<void>;
  } = $props();
</script>

{#snippet destructive()}
  <Button data-action="destructive" variant="destructive">Delete</Button>
{/snippet}
{#snippet secondary()}
  <Button data-action="secondary" variant="outline">Cancel</Button>
{/snippet}
{#snippet primary()}
  <Button data-action="primary" variant="primary" type="submit">Save</Button>
{/snippet}

<SizeProvider size="compact">
  <Form {busy} {onSubmit}>
    <FormRow>
      <FormField label="Name" name="name" description="Shown to collaborators." {error} required>
        {#snippet control(field)}
          <Input {...field} />
        {/snippet}
      </FormField>
      <FormField label="Notes" description="Optional details.">
        {#snippet control(field)}
          <Textarea {...field} />
        {/snippet}
      </FormField>
    </FormRow>
    <FormActions {destructive} {secondary} {primary} hint="⌘↵" />
  </Form>
</SizeProvider>
