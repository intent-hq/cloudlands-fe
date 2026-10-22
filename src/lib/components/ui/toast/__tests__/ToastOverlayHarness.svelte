<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import { Toast, toast } from '$lib/components/ui/toast';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';

  let { overlap = false }: { overlap?: boolean } = $props();
  let modalOpen = $state(false);
  let selections = $state(0);
  let undos = $state(0);

  function showNotifications() {
    toast.success('Added image to context', { id: 'overlay-image', duration: Infinity });
    toast('Deleted draft', {
      id: 'overlay-undo',
      duration: Infinity,
      action: { label: 'Undo', onClick: () => undos++ },
    });
  }

  onMount(() => {
    showNotifications();
    return () => {
      toast.dismiss('overlay-image');
      toast.dismiss('overlay-undo');
    };
  });
</script>

<!-- i18n-ignore (isolated browser fixture with fake workspace data) -->
<main class="min-h-screen bg-background p-6 text-foreground">
  <div class="flex gap-3">
    <Button onclick={showNotifications}>Show notifications</Button>
    <Button onclick={() => (modalOpen = true)}>New workspace</Button>
    <output aria-label="Selections">{selections}</output>
    <output aria-label="Undos">{undos}</output>
  </div>
  <div class={overlap ? 'fixed bottom-4 left-44' : 'fixed right-8 top-24'}>
    <Menu.Root>
      <Menu.Trigger>Repository menu</Menu.Trigger>
      <Menu.Content side={overlap ? 'top' : 'bottom'} align="start" class="w-64">
        <Menu.Item onSelect={() => selections++}>Pick a repository</Menu.Item>
        <Menu.Item onSelect={() => selections++}>Copy local repository</Menu.Item>
        <Menu.Item onSelect={() => selections++}>Create repository</Menu.Item>
      </Menu.Content>
    </Menu.Root>
  </div>
  <Toast />
  <NewSpaceModal bind:open={modalOpen}>
    {#snippet initializer()}
      <div class="min-h-64 p-6">
        <Popover.Root>
          <Popover.Trigger>Choose repository</Popover.Trigger>
          <Popover.Content portal={false} class="w-80 p-4">
            <Button onclick={() => selections++}>Use example repository</Button>
          </Popover.Content>
        </Popover.Root>
      </div>
    {/snippet}
  </NewSpaceModal>
</main>
