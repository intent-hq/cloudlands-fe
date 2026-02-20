<script lang="ts">
  import { Button } from '$lib/components/ui/button';

  interface Props {
    isOpen: boolean;
    isCreating: boolean;
    error: string | null;
    showAuthHelper: boolean;
    onClose: () => void;
    onCreate: () => void;
    onShowAuthHelper: () => void;
    onOpenSystemTerminal: () => void;
  }

  let {
    isOpen,
    isCreating,
    error,
    showAuthHelper,
    onClose,
    onCreate,
    onShowAuthHelper,
    onOpenSystemTerminal,
  }: Props = $props();
</script>

{#if isOpen}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (!isCreating && (e.key === 'Escape' || e.key === 'Enter')) onClose();
    }}
    onclick={() => {
      if (!isCreating) {
        onClose();
      }
    }}
  >
    <div
      class="bg-card rounded-lg shadow-lg w-full max-w-md p-6"
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
      onclick={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold text-foreground mb-4">Create New Agent</h2>

      {#if error}
        <div
          class="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive"
        >
          {error}
          {#if error.includes('authentication')}
            <button class="block mt-2 text-blue-400 hover:underline" onclick={onShowAuthHelper}>
              Show authentication help
            </button>
          {/if}
        </div>
      {/if}

      {#if showAuthHelper}
        <div
          class="mb-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded text-sm text-blue-300"
        >
          <p class="font-semibold mb-2">Authentication Required</p>
          <ol class="list-decimal list-inside space-y-1 text-xs">
            <li>
              <Button onclick={onOpenSystemTerminal}>Open System Terminal</Button>
            </li>
            <li>
              In the terminal, run: <code class="px-1 py-0.5 bg-black/30 rounded font-mono"
                >auggie login</code
              >
            </li>
            <li>Follow the authentication prompts in your browser</li>
            <li>Once authenticated, try creating the agent again</li>
          </ol>
          <p class="text-xs text-blue-300 mt-3 italic">
            Note: <code class="px-1 py-0.5 bg-black/30 rounded font-mono">auggie login</code> is an interactive
            command that requires a browser, so it must be run in a system terminal.
          </p>
        </div>
      {/if}

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onclick={onClose} disabled={isCreating}>Cancel</Button>
        <Button onclick={onCreate} disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create Agent'}
        </Button>
      </div>
    </div>
  </div>
{/if}
