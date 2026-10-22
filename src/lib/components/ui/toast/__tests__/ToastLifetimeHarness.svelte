<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { notify, type ProgressHandle } from '$lib/components/patterns/notify';
  import { Toast } from '$lib/components/ui/toast';

  let autoClosed = $state<string[]>([]);
  let progress: ProgressHandle | undefined;

  function showSuccess() {
    notify.success('Workspace saved', {
      key: 'lifetime-success',
      onAutoClose: () => autoClosed.push('success'),
    });
  }

  function showPersistent() {
    notify.info('Waiting for your decision', {
      key: 'lifetime-persistent',
      duration: Number.POSITIVE_INFINITY,
    });
  }

  function startProgress() {
    progress = notify.progress('Uploading attachment', { key: 'lifetime-progress' });
  }

  function finishProgress() {
    progress?.success('Upload finished', {
      onAutoClose: () => autoClosed.push('progress-success'),
    });
  }

  onDestroy(() => {
    ['lifetime-success', 'lifetime-persistent', 'lifetime-progress'].forEach((id) =>
      notify.dismiss(id),
    );
  });
</script>

<!-- i18n-ignore (isolated browser regression fixture) -->
<div class="min-h-screen bg-background p-4 text-foreground">
  <div class="flex flex-wrap gap-2">
    <Button onclick={showSuccess}>Show success</Button>
    <Button onclick={showPersistent}>Show persistent</Button>
    <Button onclick={startProgress}>Start upload</Button>
    <Button onclick={finishProgress}>Finish upload</Button>
  </div>
  <output aria-label="Automatically closed notifications">{autoClosed.join(',')}</output>
  <div class="fixed bottom-4 left-4 w-96 max-w-full">
    <Toast staticPosition />
  </div>
</div>
