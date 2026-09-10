<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import MicroKeySlotSquare from '$features/hardware-console/components/MicroKeySlotSquare.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Headline, e.g. "Implementor failed". */
    title: string;
    /** Truncated error message for the failed agent. */
    errorSummary: string;
    /** Resolved "Agent — Workspace" context line (absent when unresolvable). */
    contextLine?: string;
    /** "Retry <name>" (or plain "Retry" when the name is unresolvable). */
    retryLabel: string;
    /** Disables the retry button while the retry is in flight. */
    retrying: boolean;
    /** Brief note when the retry failed (entry kept in the registry). */
    retryNote?: string;
    /** Resolved 0-based micro key slot of the workspace (badge hidden when null). */
    keySlot?: number | null;
    /** Provider auth failure: login command to run (copyable guidance). */
    loginCommandHint?: string;
    /** claude-code auth failure: desktop-app sign-in doesn't carry over to the CLI. */
    showClaudeDesktopNote?: boolean;
    onRetry: () => void;
    /** Navigate to the agent WITHOUT retrying. */
    onSwitchTo: () => void;
    onClose: () => void;
  }

  let {
    title,
    errorSummary,
    contextLine,
    retryLabel,
    retrying,
    retryNote,
    keySlot = null,
    loginCommandHint,
    showClaudeDesktopNote = false,
    onRetry,
    onSwitchTo,
    onClose,
  }: Props = $props();

  let metadata = $derived(contextLine?.replace(' — ', ' / '));
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding);
     the destructive border tint is passed as a wrapper class by the service. -->
<div
  class="relative flex w-full min-w-0 items-start gap-2.5 pr-6"
  data-toast-layout="agent-failure"
>
  <ToastGlyph variant="error" />

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-1.5">
      {#if keySlot != null}
        <MicroKeySlotSquare slot={keySlot} />
      {/if}
      <p class="toast-title min-w-0 break-words">{title}</p>
    </div>
    <p class="toast-description line-clamp-2 break-words">{errorSummary}</p>

    {#if loginCommandHint}
      <div class="mt-1.5 flex min-w-0 flex-col gap-1" data-testid="toast-auth-guidance">
        <p class="text-xs text-muted-foreground">{m.settings_providers_runToLogIn_label()}</p>
        <div class="flex items-center gap-1">
          <code
            class="rounded bg-muted px-1.5 py-0.5 text-xs"
            data-testid="toast-auth-login-command">{loginCommandHint}</code
          >
          <CopyButton text={loginCommandHint} size="xs" />
        </div>
        {#if showClaudeDesktopNote}
          <p
            class="text-xs text-muted-foreground break-words"
            data-testid="toast-auth-claude-desktop-note"
          >
            {m.settings_providers_claudeDesktopNote_label()}
          </p>
        {/if}
      </div>
    {/if}

    {#if metadata}
      <p class="toast-metadata min-w-0 truncate">
        <span class="toast-metadata-dot" aria-hidden="true"></span>
        {metadata}
      </p>
    {/if}

    {#if retryNote}
      <p class="text-xs text-danger mt-1.5 break-words">{retryNote}</p>
    {/if}

    <!-- Action buttons -->
    <div class="toast-actions">
      <Button
        variant="outline"
        size="compact"
        class="toast-action"
        disabled={retrying}
        onclick={onRetry}
      >
        {retrying ? m.ui_agentFailureToast_retrying_label() : retryLabel}
      </Button>
      <Button variant="ghost" size="compact" class="toast-action" onclick={onSwitchTo}>
        {m.agent_failureToast_switchTo_label()}
      </Button>
    </div>
  </div>

  <!-- Close button -->
  <ToastCloseButton onclick={onClose} ariaLabel={m.ui_agentFailureToast_close_ariaLabel()} />
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .toast-title {
    color: hsl(var(--foreground));
    font-size: var(--toast-title-size, 0.8125rem);
    font-weight: 500;
    line-height: 1.4;
  }

  .toast-description {
    margin-top: 0.25rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--toast-description-size, 0.8125rem);
    font-weight: 400;
    line-height: 1.4;
  }

  .toast-metadata {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.625rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
  }

  .toast-metadata-dot {
    width: 0.375rem;
    height: 0.375rem;
    flex: 0 0 auto;
    border-radius: var(--radius-full);
    background: hsl(var(--info));
  }

  .toast-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  :global(.toast-action) {
    min-height: var(--toast-action-height, var(--control-height-compact));
    border-radius: var(--toast-action-radius, var(--radius));
  }

  :global(.toast-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>
