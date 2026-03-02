<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SpecialistSettings from '$lib/components/settings/SpecialistSettings.svelte';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    open?: boolean;
    onClose?: () => void;
  }

  let { open = $bindable(false), onClose }: Props = $props();

  function close() {
    open = false;
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={close}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Manage Specialists</h2>
          <p class="text-sm text-subtle mt-0.5">
            Customize AI specialists or create your own.
          </p>
        </div>
        <Button variant="ghost" size="icon" onclick={close}>
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6">
        <SpecialistSettings />
      </div>
    </div>
  </div>
{/if}
