<script lang="ts">
  import FormDialog from './FormDialog.svelte';
  let { rejectPending = false }: { rejectPending?: boolean } = $props();
  let submitted = $state(0);
  let cancelled = $state(0);
  let rejectSubmission: ((reason: Error) => void) | undefined;
  $effect(() => {
    if (rejectPending) rejectSubmission?.(new Error('Unavailable'));
  });
  async function submit() {
    submitted++;
    if (submitted === 1)
      await new Promise<void>((_resolve, reject) => {
        rejectSubmission = reject;
      });
  }
</script>

<FormDialog
  open
  title="Retry submission"
  submitLabel="Save"
  cancelLabel="Cancel"
  onSubmit={submit}
  onCancel={() => cancelled++}
/>
<output data-testid="submission-count">{submitted}</output>
<output data-testid="cancellation-count">{cancelled}</output>
