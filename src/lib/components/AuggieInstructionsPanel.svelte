<script lang="ts">
  /**
   * AuggieInstructionsPanel
   *
   * Renders an ordered list of manual setup steps plus a copyable command,
   * exactly as returned by AUGGIE_CHANNELS.INSTALL / AUTHENTICATE
   * (`data.instructions` + `data.command`). The renderer no longer drives the
   * install/login flow itself — the daemon returns the steps the user must run
   * in their own terminal, and this panel is the surface that displays them.
   */
  import { slide } from 'svelte/transition';
  import { faPaste, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';

  interface Props {
    /** Ordered manual setup steps returned by the IPC handler. */
    instructions: string[];
    /** Copyable shell command returned by the IPC handler (e.g. `auggie login`). */
    command?: string;
    /** Called when the user clicks "I've done this — check again". */
    onRecheck?: () => void;
    /** Called when the user dismisses the panel. Hides the panel if provided. */
    onDismiss?: () => void;
    /** Whether the recheck action is currently running. */
    rechecking?: boolean;
  }

  let {
    instructions,
    command,
    onRecheck,
    onDismiss,
    rechecking = false,
  }: Props = $props();

  async function copyCommand() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy command');
    }
  }
</script>

<div
  class="flex flex-col gap-2 p-3 rounded-lg bg-muted/50 border border-border text-xs"
  transition:slide={{ axis: 'y', duration: 200 }}
  data-testid="auggie-instructions-panel"
>
  <div class="flex items-start justify-between gap-2">
    <ol class="list-decimal pl-4 space-y-1 flex-1 min-w-0">
      {#each instructions as step (step)}
        <li class="text-foreground/90">{step}</li>
      {/each}
    </ol>
    {#if onDismiss}
      <button
        type="button"
        class="shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        onclick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss instructions"
      >
        <Fa icon={faXmark} size="sm" />
      </button>
    {/if}
  </div>

  {#if command}
    <button
      type="button"
      class="flex items-center gap-1.5 px-2 py-1 bg-background border border-border rounded font-mono text-xs text-foreground hover:bg-muted transition-colors w-fit cursor-pointer"
      onclick={copyCommand}
      title="Click to copy"
      data-testid="auggie-instructions-copy"
    >
      <code>{command}</code>
      <Fa icon={faPaste} size="xs" />
    </button>
  {/if}

  {#if onRecheck}
    <div class="flex gap-3 text-xs pt-1">
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium disabled:opacity-50"
        onclick={onRecheck}
        disabled={rechecking}
        data-testid="auggie-instructions-recheck"
      >
        {rechecking ? 'Checking…' : "I've done this — check again"}
      </button>
    </div>
  {/if}
</div>
